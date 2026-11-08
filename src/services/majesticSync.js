const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { PermissionFlagsBits } = require('discord.js')
const { readConfig, fetchMembers } = require('./majesticClient')
const { buildPreview, rankRoles, tierRoles } = require('../features/majestic/syncPreview')

const problem = (status, message) => Object.assign(new Error(message), { status })
const describe = row => JSON.stringify([row.status, row.static, row.gameRank, row.currentNickname,
	row.currentRoleIds, row.nickname, row.addRoles, row.removeRoles])

function createMajesticSync({ pool, store, env = process.env, readFamily, now = Date.now, logger = console, sleep = delay }) {
	require('dotenv').config({ path: path.join(__dirname, '../../.env.majestic.local'), quiet: true })
	const entries = new Map()
	function safeText(value) {
		let text = String(value ?? '')
		for (const [key, secret] of Object.entries({ ...process.env, ...env })) {
			if (/TOKEN|SECRET|PASSWORD|SESSION|DATABASE_URL|API_KEY/i.test(key) && secret) text = text.split(String(secret)).join('[REDACTED]')
		}
		return text.replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+/gi, '[URL]')
			.replace(/((?:authorization|cookie|x-session|sessionId|token|password)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]').slice(0, 2000)
	}
	function logFailure(stage, targetId, error) {
		logger.error('[Majestic] Ошибка синхронизации', {
			stage, targetId, name: safeText(error?.name), code: safeText(error?.code),
			status: safeText(error?.status), message: safeText(error?.message ?? error),
			stack: safeText(String(error?.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 6).join('\n'))
		})
	}
	async function diagnose(stage, guildId, work) {
		try { return await work() }
		catch (error) { logFailure(stage, guildId, error); throw error }
	}
	async function memberForChange(guild, row, result) {
		try {
			return await diagnose('discord.member.fetch:' + row.discordId, guild.id,
				() => guild.members.fetch({ user: row.discordId, force: true }))
		} catch {
			result.status = 'failed'
			result.error = 'Не удалось получить участника из Discord. Остальные участники обрабатываются.'
			return null
		}
	}
	const audit = (actor, action, target, details) => diagnose('audit: ' + action, target,
		() => store.audit(actor, action, target, details))
	let ready
	async function entry(guildId) {
		if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS majestic_sync_state (
			guild_id TEXT PRIMARY KEY, value JSONB NOT NULL
		)`).catch(error => { ready = null; throw error })
		await ready
		if (!entries.has(guildId)) entries.set(guildId, (async () => {
			const result = await pool.query('SELECT value FROM majestic_sync_state WHERE guild_id = $1', [guildId])
			const state = result.rows[0]?.value || { decisions: {}, preview: null, run: null }
			const item = { state, busy: false, writes: Promise.resolve(), task: null }
			if (state.run?.status === 'running') {
				state.run.status = 'interrupted'
				state.run.error = 'Бот перезапущен. Проверьте результат и создайте новый предпросмотр.'
				if (state.preview) state.preview.invalidated = true
				await save(guildId, item)
			}
			return item
		})().catch(error => { entries.delete(guildId); throw error }))
		return entries.get(guildId)
	}
	function save(guildId, item) {
		item.writes = item.writes.catch(() => {}).then(() => diagnose('database.save', guildId, () => pool.query(
			'INSERT INTO majestic_sync_state (guild_id, value) VALUES ($1, $2::jsonb) ON CONFLICT (guild_id) DO UPDATE SET value = EXCLUDED.value',
			[guildId, JSON.stringify(item.state)])))
		return item.writes
	}
	async function family(guildId) {
		if (readFamily) return diagnose('majestic.members', guildId, readFamily)
		try { return await diagnose('majestic.members', guildId, () => fetchMembers(readConfig(env))) }
		catch { throw problem(502, 'Не удалось получить полный состав Majestic. Проверьте сессию в окружении сервера и доступность сайта.') }
	}
	function view(item) {
		return structuredClone({ ...item.state, busy: item.busy, rankRoles,
			configured: Boolean(readFamily || (env.MAJESTIC_SESSION_ID && env.MAJESTIC_SERVER && env.MAJESTIC_CHARACTER_ID)) })
	}
	async function discordMembers(guild) {
		for (let attempt = 0; ; attempt++) {
			try { return await guild.members.fetch({ time: 30000 }) }
			catch (error) {
				const seconds = error?.data?.retry_after
				if (error?.name !== 'GatewayRateLimitError' || error.data?.opcode !== 8 ||
					!Number.isFinite(seconds) || seconds < 0 || seconds > 60 || attempt >= 2) throw error
				const waitMs = Math.ceil(seconds * 1000) + 250
				logger.error('[Majestic] Лимит Discord: ожидание перед повтором загрузки участников', {
					guildId: guild.id, attempt: attempt + 1, waitMs
				})
				await sleep(waitMs)
			}
		}
	}
	async function snapshot(guild, decisions, { nicknamesOnly = false } = {}) {
		const data = await family(guild.id)
		if (!data.total || data.items.length !== data.total) throw problem(502, 'Получен пустой или неполный состав Majestic. Изменения остановлены.')
		await diagnose('discord.roles.fetch', guild.id, () => guild.roles.fetch())
		const members = await diagnose('discord.members.fetch', guild.id, () => discordMembers(guild))
		const rows = buildPreview(data.items, [...members.values()].map(member => ({
			id: member.id, nickname: member.nickname, bot: member.user.bot, roleIds: [...member.roles.cache.keys()]
		})), { decisions, adminRoleIds: store.roleIds('ADMIN_ROLES'), rolePrefixes: store.getSetting('ROLE_PREFIXES'), nicknamesOnly })
		for (const row of rows) {
			if (row.status !== 'change') continue
			const member = members.get(row.discordId)
			const issues = []
			if (row.nickname && (!member.manageable || !guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames))) issues.push('Нет прав на изменение ника.')
			if (row.addRoles.length || row.removeRoles.length) {
				if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Нет права Manage Roles.')
				for (const id of [...row.addRoles, ...row.removeRoles]) if (!guild.roles.cache.get(id)?.editable) issues.push(`Роль ${id} отсутствует или недоступна.`)
			}
			if (issues.length) { row.status = 'blocked'; row.reason = issues.join(' ') }
		}
		const summary = {}
		for (const row of rows) summary[row.status] = (summary[row.status] || 0) + 1
		return { id: randomUUID(), generatedAt: now(), source: `${env.MAJESTIC_SERVER}/${env.MAJESTIC_CHARACTER_ID}`, familyTotal: data.total, rows, summary }
	}
	async function start(guild, actor, kind, work) {
		const item = await entry(guild.id)
		if (item.busy) throw problem(409, 'Синхронизация уже выполняется.')
		item.busy = true
		try {
			await audit(actor, 'majestic.' + kind + '.request', guild.id)
			item.state.run = { id: randomUUID(), kind, status: 'running', startedAt: now(), total: 0, completed: 0, results: [], stopRequested: false }
			await save(guild.id, item)
		} catch (error) { item.busy = false; throw error }
		item.task = (async () => {
			try {
				await work(item)
				item.state.run.status = item.state.run.stopRequested ? 'stopped' :
					item.state.run.results.some(result => result.status === 'failed') ? 'completed_with_errors' : 'completed'
			} catch (error) {
				logFailure(kind, guild.id, error)
				item.state.run.status = 'failed'
				item.state.run.error = error.status ? safeText(error.message) : 'Операция остановлена: ошибка Discord или базы. Уже выполненные действия видны в результатах. Создайте новый предпросмотр.'
			} finally {
				item.state.run.finishedAt = now()
				try {
					await save(guild.id, item)
					await audit(actor, 'majestic.' + kind + '.result', guild.id, { runId: item.state.run.id, status: item.state.run.status, completed: item.state.run.completed })
				} catch (error) { logFailure('finalize.' + kind, guild.id, error); item.state.run.status = 'failed'; item.state.run.error = 'Не удалось сохранить результат в базе. Проверьте Discord перед повторным запуском.' }
				item.busy = false
			}
		})()
		return view(item)
	}
	return {
		async state(guild) { return view(await entry(guild.id)) },
		async autoNicknames(guild) {
			const item = await entry(guild.id)
			if (item.busy || !store.getSetting('MAJESTIC_AUTO_NICKNAMES')) return null
			const actor = { id: 'majestic-auto', name: 'Автосинхронизация Majestic' }
			return start(guild, actor, 'sync', async current => {
				const report = await snapshot(guild, current.state.decisions)
				for (const row of report.rows) {
					if (current.state.run.stopRequested || !store.getSetting('MAJESTIC_AUTO_NICKNAMES')) {
						current.state.run.stopRequested = true
						break
					}
					// gameRank is present only for an unambiguous static found in the family.
					if (!row.static || !row.gameRank || current.state.decisions[row.discordId]?.static) continue
					await audit(actor, 'majestic.bind.auto', row.discordId, { static: row.static })
					current.state.decisions[row.discordId] = { ...current.state.decisions[row.discordId], static: row.static }
					if (current.state.preview) current.state.preview.invalidated = true
				}
				const selected = report.rows.filter(row => row.status === 'change')
				current.state.run.total = selected.length
				current.state.run.summary = report.summary
				await save(guild.id, current)
				for (const row of selected) {
					if (!store.getSetting('MAJESTIC_AUTO_NICKNAMES')) current.state.run.stopRequested = true
					if (current.state.run.stopRequested) break
					const result = { discordId: row.discordId, before: row.currentNickname, nickname: row.nickname,
						addRoles: row.addRoles, removeRoles: row.removeRoles, status: 'skipped' }
					current.state.run.results.push(result)
					const member = await memberForChange(guild, row, result)
					if (member && (member.nickname !== row.currentNickname || JSON.stringify([...member.roles.cache.keys()].sort()) !== JSON.stringify(row.currentRoleIds))) {
						result.error = 'Ник или роли изменились после проверки.'
					} else if (member) {
						await audit(actor, 'majestic.member.request', row.discordId, { runId: current.state.run.id, ...result })
						if (!store.getSetting('MAJESTIC_AUTO_NICKNAMES')) current.state.run.stopRequested = true
						if (current.state.run.stopRequested) break
						if (current.state.preview) current.state.preview.invalidated = true
						result.status = 'applying'
						await save(guild.id, current)
						const payload = { reason: `Majestic auto sync; run ${current.state.run.id}` }
						if (row.nickname) payload.nick = row.nickname
						if (row.addRoles.length || row.removeRoles.length) payload.roles = [...member.roles.cache.keys()]
							.filter(id => id !== guild.id && !row.removeRoles.includes(id)).concat(row.addRoles)
						try {
							await diagnose('discord.member.edit:' + row.discordId, guild.id, () => member.edit(payload))
							result.status = 'applied'
						} catch {
							result.status = 'failed'
							result.error = 'Discord не подтвердил изменение ника или ролей. Следующая проверка прочитает актуальное состояние.'
						}
					}
					current.state.run.completed++
					await save(guild.id, current)
					await audit(actor, 'majestic.member.result', row.discordId, { runId: current.state.run.id, ...result })
				}
			})
		},
		preview(guild, actor) {
			return start(guild, actor, 'preview', async item => {
				item.state.preview = await snapshot(guild, item.state.decisions)
				item.state.run.total = item.state.preview.rows.length
				item.state.run.completed = item.state.run.total
			})
		},
		async resolve(guild, actor, body) {
			const item = await entry(guild.id)
			if (item.busy) throw problem(409, 'Дождитесь завершения операции.')
			if (!body || typeof body.discordId !== 'string' || !/^\d{17,20}$/.test(body.discordId)) throw problem(400, 'Некорректный Discord ID.')
			const { discordId, static: staticId, tierRoleId, excluded, reset } = body
			if (staticId !== undefined && (typeof staticId !== 'string' || !/^[1-9]\d{0,15}$/.test(staticId))) throw problem(400, 'Некорректный static.')
			if (tierRoleId !== undefined && !tierRoles.has(tierRoleId)) throw problem(400, 'Выберите Tier 1/2/3.')
			if ((excluded !== undefined && typeof excluded !== 'boolean') || (reset !== undefined && typeof reset !== 'boolean')) throw problem(400, 'Некорректное решение.')
			const previous = structuredClone(item.state)
			item.busy = true
			try {
				const member = await guild.members.fetch({ user: discordId, force: true })
				if (member.user.bot) throw problem(400, 'Привязка бота запрещена.')
				if (tierRoleId && !member.roles.cache.has(tierRoleId)) throw problem(400, 'Можно сохранить только уже выданную Tier-роль.')
				if (staticId && !(await family(guild.id)).items.some(character => String(character.id) === staticId)) throw problem(400, 'Static не найден в составе семьи.')
				const decision = { ...(item.state.decisions[discordId] || {}),
					...(staticId === undefined ? {} : { static: staticId }),
					...(tierRoleId === undefined ? {} : { tierRoleId }),
					...(excluded === undefined ? {} : { excluded }) }
				await audit(actor, 'majestic.resolve', discordId, { decision: reset ? null : decision })
				if (reset) delete item.state.decisions[discordId]
				else item.state.decisions[discordId] = decision
				if (item.state.preview) item.state.preview.invalidated = true
				await save(guild.id, item)
			} catch (error) { item.state = previous; throw error }
			finally { item.busy = false }
			return view(item)
		},
		async apply(guild, actor, body) {
			const item = await entry(guild.id)
			const preview = item.state.preview
			if (!preview || preview.id !== body?.previewId || preview.invalidated || now() - preview.generatedAt > 15 * 60 * 1000) throw problem(409, 'Предпросмотр устарел. Получите новый состав.')
			if (!Array.isArray(body.discordIds) || !body.discordIds.length || body.discordIds.length > preview.rows.length || new Set(body.discordIds).size !== body.discordIds.length) throw problem(400, 'Выберите участников для применения.')
			const selected = body.discordIds.map(id => preview.rows.find(row => row.discordId === id && row.status === 'change'))
			if (selected.some(row => !row)) throw problem(400, 'Можно применить только строки без конфликтов и блокировок.')
			return start(guild, actor, 'apply', async current => {
				if (current.state.preview !== preview || preview.invalidated) throw problem(409, 'Решения или предпросмотр изменились. Получите новый состав.')
				preview.invalidated = true
				current.state.run.total = selected.length
				await save(guild.id, current)
				const fresh = await snapshot(guild, current.state.decisions)
				if (fresh.source !== preview.source) throw problem(409, 'Изменён сервер или персонаж Majestic. Получите новый предпросмотр.')
				if (selected.some(row => describe(row) !== describe(fresh.rows.find(next => next.discordId === row.discordId) || {}))) throw problem(409, 'Состав, ники или роли изменились. Получите новый предпросмотр.')
				for (const row of selected) {
					if (current.state.run.stopRequested) break
					const result = { discordId: row.discordId, status: 'applying', before: row.currentNickname, nickname: row.nickname, addRoles: row.addRoles, removeRoles: row.removeRoles }
					current.state.run.results.push(result)
					await save(guild.id, current)
					const member = await memberForChange(guild, row, result)
					if (member && (member.nickname !== row.currentNickname || JSON.stringify([...member.roles.cache.keys()].sort()) !== JSON.stringify(row.currentRoleIds))) {
						result.status = 'skipped'; result.error = 'Ник или роли изменены после предпросмотра.'
					} else if (member) {
						await audit(actor, 'majestic.member.request', row.discordId, { runId: current.state.run.id, ...result })
						if (current.state.run.stopRequested) {
							result.status = 'skipped'; result.error = 'Остановлено до изменения Discord.'
							break
						}
						const payload = { reason: `Majestic sync by ${actor.id || actor}; run ${current.state.run.id}` }
						if (row.nickname) payload.nick = row.nickname
						if (row.addRoles.length || row.removeRoles.length) payload.roles = [...member.roles.cache.keys()]
							.filter(id => id !== guild.id && !row.removeRoles.includes(id)).concat(row.addRoles)
						try {
							await diagnose('discord.member.edit:' + row.discordId, guild.id, () => member.edit(payload))
							result.status = 'applied'
						} catch {
							result.status = 'failed'; result.error = 'Discord не подтвердил изменение. Проверьте текущее состояние перед повтором.'
						}
					}
					current.state.run.completed++
					await save(guild.id, current)
					await audit(actor, 'majestic.member.result', row.discordId, { runId: current.state.run.id, ...result })
				}
			})
		},
		async stop(guild, actor) {
			const item = await entry(guild.id)
			if (item.busy && item.state.run?.status === 'running') {
				await audit(actor, 'majestic.stop', guild.id)
				item.state.run.stopRequested = true
				await save(guild.id, item)
			}
			return view(item)
		},
		async wait(guild) { await (await entry(guild.id)).task }
	}
}

module.exports = { createMajesticSync }
