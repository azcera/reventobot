import { getError } from '../utils/errors'
import type { SyncEntry, RunningEntry, SyncState, SyncPreview, SyncResult } from './majesticTypes'
interface SyncOptions { pool: Pg.Pool; store: T.Store; env?: T.Env; readFamily?: () => Promise<T.FamilyMembers>; readDismissals?: () => Promise<T.FamilyDismissal[]>; now?: () => number; logger?: Pick<Console, 'error'>; sleep?: typeof delay }
interface ResolveBody { discordId?: string; static?: string; tierRoleId?: string; excluded?: boolean; reset?: boolean }
interface ApplyBody { previewId?: string; discordIds?: string[] }
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import path = require('node:path')
import { config as loadEnvironment } from 'dotenv'
import { ROOT_PATH } from '../config/path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { PermissionFlagsBits } from 'discord.js'
import { readConfig, fetchMembers, fetchDismissals } from './majesticClient'
import { loadSavedMajesticSession } from './telegramMajesticSession'
import { loadDiscordMembers } from './discordMembers'
import { buildPreview, rankRoles, tierRoles, parseNickname } from '../features/majestic/syncPreview'

const problem = (status: number, message: string) => Object.assign(new Error(message), { status })
const describe = (row: Partial<T.PreviewRow>) => JSON.stringify([row.status, row.static, row.gameRank, row.currentNickname,
	row.currentRoleIds, row.nickname, row.addRoles, row.removeRoles])

function createMajesticSync({ pool, store, env = process.env, readFamily, readDismissals, now = Date.now, logger = console, sleep = delay }: SyncOptions) {
	loadEnvironment({ path: path.join(ROOT_PATH, '.env.majestic.local'), quiet: true })
	if (env === process.env) loadSavedMajesticSession()
	const entries = new Map<string, Promise<SyncEntry>>()
	function safeText(value: unknown) {
		let text = String(value ?? '')
		for (const [key, secret] of Object.entries({ ...process.env, ...env })) {
			if (/TOKEN|SECRET|PASSWORD|SESSION|DATABASE_URL|API_KEY/i.test(key) && secret) text = text.split(String(secret)).join('[REDACTED]')
		}
		return text.replace(/https?:\/\/\S+|postgres(?:ql)?:\/\/\S+/gi, '[URL]')
			.replace(/((?:authorization|cookie|x-session|sessionId|token|password)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]').slice(0, 2000)
	}
	function logFailure(stage: string, targetId: string, caught: unknown) {
		const error = getError(caught);
		logger.error('[Majestic] Ошибка синхронизации', {
			stage, targetId, name: safeText(error?.name), code: safeText(error?.code),
			status: safeText(error?.status), message: safeText(error?.message ?? error),
			stack: safeText(String(error?.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 6).join('\n'))
		})
	}
	async function diagnose<R>(stage: string, guildId: string, work: () => Promise<R>): Promise<R> {
		try { return await work() }
		catch (caught) {
			const error = getError(caught); logFailure(stage, guildId, error); throw error }
	}
	async function memberForChange(guild: D.Guild, row: T.PreviewRow, result: SyncResult) {
		try {
			return await diagnose('discord.member.fetch:' + row.discordId, guild.id,
				() => guild.members.fetch({ user: row.discordId, force: true }))
		} catch {
			result.status = 'failed'
			result.error = 'Не удалось получить участника из Discord. Остальные участники обрабатываются.'
			return null
		}
	}
	const audit = (actor: T.Actor | undefined, action: string, target: string, details: Record<string, unknown> = {}) => diagnose('audit: ' + action, target,
		() => store.audit(actor, action, target, details))
	let ready: Promise<unknown> | null = null
	async function entry(guildId: string) {
		if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS majestic_sync_state (
			guild_id TEXT PRIMARY KEY, value JSONB NOT NULL
		)`).catch(error => { ready = null; throw error })
		await ready
		if (!entries.has(guildId)) entries.set(guildId, (async () => {
			const result = await pool.query<{ value: SyncState }>('SELECT value FROM majestic_sync_state WHERE guild_id = $1', [guildId])
			const state = result.rows[0]?.value || { decisions: {}, preview: null, run: null }
			const item: SyncEntry = { state, busy: false, writes: Promise.resolve(), task: null }
			if (state.run?.status === 'running') {
				state.run.status = 'interrupted'
				state.run.error = 'Бот перезапущен. Проверьте результат и создайте новый предпросмотр.'
				if (state.preview) state.preview.invalidated = true
				await save(guildId, item)
			}
			return item
		})().catch(error => { entries.delete(guildId); throw error }))
		return entries.get(guildId)!
	}
	function save(guildId: string, item: SyncEntry) {
		item.writes = item.writes.catch(() => {}).then(() => diagnose('database.save', guildId, () => pool.query(
			'INSERT INTO majestic_sync_state (guild_id, value) VALUES ($1, $2::jsonb) ON CONFLICT (guild_id) DO UPDATE SET value = EXCLUDED.value',
			[guildId, JSON.stringify(item.state)])))
		return item.writes
	}
	async function family(guildId: string) {
		if (readFamily) return diagnose('majestic.members', guildId, readFamily)
		try { return await diagnose('majestic.members', guildId, () => fetchMembers(readConfig(env))) }
		catch { throw problem(502, 'Не удалось получить полный состав Majestic. Проверьте сессию в окружении сервера и доступность сайта.') }
	}
	function view(item: SyncEntry) {
		return structuredClone({ ...item.state, busy: item.busy, rankRoles,
			configured: Boolean(readFamily || (env.MAJESTIC_SESSION_ID && env.MAJESTIC_SERVER && env.MAJESTIC_CHARACTER_ID)) })
	}
	const discordMembers = (guild: D.Guild) => loadDiscordMembers(guild, { now, sleep,
		onRateLimit: details => logger.error('[Majestic] Лимит Discord: ожидание перед повтором загрузки участников', details) })
	async function snapshot(guild: D.Guild, decisions: Record<string, T.MemberDecision>, { nicknamesOnly = false } = {}) {
		const data = await family(guild.id)
		if (!data.total || data.items.length !== data.total) throw problem(502, 'Получен пустой или неполный состав Majestic. Изменения остановлены.')
		await diagnose('discord.roles.fetch', guild.id, () => guild.roles.fetch())
		const members = await diagnose('discord.members.fetch', guild.id, () => discordMembers(guild))
		const rows = buildPreview(data.items, [...members.values()].map((member: D.GuildMember) => ({
			id: member.id, nickname: member.nickname, bot: member.user.bot, roleIds: [...member.roles.cache.keys()]
		})), { decisions, adminRoleIds: store.roleIds('ADMIN_ROLES'), rolePrefixes: store.getSetting('ROLE_PREFIXES') as T.RolePrefix[], nicknamesOnly })
		for (const row of rows) {
			if (row.status !== 'change') continue
			const member = members.get(row.discordId)!
			const issues = []
			if (row.nickname && (!member.manageable || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames))) issues.push('Нет прав на изменение ника.')
			if (row.addRoles.length || row.removeRoles.length) {
				if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Нет права Manage Roles.')
				for (const id of [...row.addRoles, ...row.removeRoles]) if (!guild.roles.cache.get(id)?.editable) issues.push(`Роль ${id} отсутствует или недоступна.`)
			}
			if (issues.length) { row.status = 'blocked'; row.reason = issues.join(' ') }
		}
		const summary: Record<string, number> = {}
		for (const row of rows) summary[row.status] = (summary[row.status] || 0) + 1
		return { id: randomUUID(), generatedAt: now(), source: `${env.MAJESTIC_SERVER}/${env.MAJESTIC_CHARACTER_ID}`, familyTotal: data.total, rows, summary }
	}
	async function start(guild: D.Guild, actor: T.Actor | undefined, kind: string, work: (item: RunningEntry) => Promise<void>, existingItem?: SyncEntry) {
		const item = existingItem || await entry(guild.id)
		if (item.busy) throw problem(409, 'Синхронизация уже выполняется.')
		item.busy = true
		try {
			await audit(actor, 'majestic.' + kind + '.request', guild.id)
			item.state.run = { id: randomUUID(), kind, status: 'running', startedAt: now(), total: 0, completed: 0, results: [], stopRequested: false }
			await save(guild.id, item)
		} catch (caught) {
			const error = getError(caught); item.busy = false; throw error }
		item.task = (async () => {
			try {
				await work(item as RunningEntry)
				item.state.run!.status = item.state.run!.stopRequested ? 'stopped' :
					item.state.run!.results.some(result => result.status === 'failed') ? 'completed_with_errors' : 'completed'
			} catch (caught) {
			const error = getError(caught);
				logFailure(kind, guild.id, error)
				item.state.run!.status = 'failed'
				item.state.run!.error = error.status ? safeText(error.message) : 'Операция остановлена: ошибка Discord или базы. Уже выполненные действия видны в результатах. Создайте новый предпросмотр.'
			} finally {
				item.state.run!.finishedAt = now()
				try {
					await save(guild.id, item)
					await audit(actor, 'majestic.' + kind + '.result', guild.id, { runId: item.state.run!.id, status: item.state.run!.status, completed: item.state.run!.completed })
				} catch (caught) {
			const error = getError(caught); logFailure('finalize.' + kind, guild.id, error); item.state.run!.status = 'failed'; item.state.run!.error = 'Не удалось сохранить результат в базе. Проверьте Discord перед повторным запуском.' }
				item.busy = false
			}
		})()
		return view(item)
	}
	return {
		async state(guild: D.Guild) { return view(await entry(guild.id)) },
		async membershipSnapshot(guild: D.Guild, { includeDismissals = false } = {}): Promise<T.MembershipSnapshot> {
			const item = await entry(guild.id)
			if (item.busy) throw Object.assign(problem(409, 'Синхронизация уже выполняется. Повторите позже.'), { code: 'MAJESTIC_SYNC_BUSY' })
			item.busy = true
			try {
				const source = `${env.MAJESTIC_SERVER}/${env.MAJESTIC_CHARACTER_ID}`
				const autoKick = store.getSetting('MAJESTIC_AUTO_KICK')
				const previous = item.state.familyMembership
				const settingChangedAt = store.majesticAutoKickChangedAt || 0
				const autoKickSince = autoKick ? Math.max((previous?.source === source ? previous.autoKickSince : undefined) ?? now(), settingChangedAt) : undefined
				// Read events before the roster: a re-invited player must be protected by the newer roster.
				const dismissals = autoKick && includeDismissals
					? await diagnose('majestic.dismissals', guild.id, () => readDismissals ? readDismissals() : fetchDismissals(readConfig(env))) : []
				const data = await family(guild.id)
				if (!data.total || data.items.length !== data.total) throw problem(502, 'Получен пустой или неполный состав Majestic.')
				const members = await discordMembers(guild)
				const statics = new Set(data.items.map(character => String(character.id)))
				const bindings = { ...(previous?.source === source ? previous.bindings : {}) }
				const confirmed = { ...(previous?.source === source ? previous.confirmed : {}) }
				const linkedCandidates = new Map<string, string | undefined>([...members.values()].filter((member: D.GuildMember) => !member.user.bot).map((member: D.GuildMember) =>
					[member.id, item.state.decisions[member.id]?.static || bindings[member.id] || parseNickname(member.nickname)?.static]))
				const linked = new Map([...linkedCandidates].filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
				const counts = new Map<string, number>()
				for (const staticId of linked.values()) if (staticId) counts.set(staticId, (counts.get(staticId) || 0) + 1)
				for (const [id, staticId] of linked) {
					if (statics.has(staticId) && counts.get(staticId) === 1) bindings[id] = staticId
					const member = members.get(id)!
					const nicknameStatic = parseNickname(member.nickname)?.static
					const conflictingNickname = [...members.values()].some(other => other.id !== id && !other.user.bot && parseNickname(other.nickname)?.static === staticId)
					if (item.state.decisions[id]?.excluded || counts.get(staticId) !== 1 || conflictingNickname ||
						(nicknameStatic && nicknameStatic !== staticId) || !member.joinedTimestamp ||
						(confirmed[id] && (confirmed[id].static !== staticId || confirmed[id].joinedAt !== member.joinedTimestamp))) delete confirmed[id]
					if (statics.has(staticId) && !item.state.decisions[id]?.excluded && counts.get(staticId) === 1 && !conflictingNickname &&
						(!nicknameStatic || nicknameStatic === staticId) && member.joinedTimestamp) {
						confirmed[id] = { static: staticId, seenAt: now(), joinedAt: member.joinedTimestamp }
					}
				}
				for (const id of Object.keys(confirmed)) if (!linked.has(id)) delete confirmed[id]
				if (source !== `${env.MAJESTIC_SERVER}/${env.MAJESTIC_CHARACTER_ID}` || autoKick !== store.getSetting('MAJESTIC_AUTO_KICK') ||
					settingChangedAt !== (store.majesticAutoKickChangedAt || 0)) throw problem(409, 'Настройки Majestic изменились. Проверка остановлена.')
				item.state.familyMembership = { source, bindings, confirmed, autoKickSince }
				await save(guild.id, item)
				return { members, statics, linked, bindings, confirmed, dismissals, autoKickSince, source }
			} finally { item.busy = false }
		},
		async autoNicknames(guild: D.Guild) {
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
					const result: SyncResult = { discordId: row.discordId, before: row.currentNickname, nickname: row.nickname,
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
						const payload: D.GuildMemberEditOptions = { reason: `Majestic auto sync; run ${current.state.run.id}` }
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
			}, item)
		},
		preview(guild: D.Guild, actor: T.Actor | undefined) {
			return start(guild, actor, 'preview', async item => {
				item.state.preview = await snapshot(guild, item.state.decisions)
				item.state.run!.total = item.state.preview.rows.length
				item.state.run!.completed = item.state.run!.total
			})
		},
		async resolve(guild: D.Guild, actor: T.Actor | undefined, body: ResolveBody) {
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
				if (item.state.familyMembership && (reset || staticId !== undefined || excluded !== undefined)) {
					delete item.state.familyMembership.confirmed?.[discordId]
					if (reset) delete item.state.familyMembership.bindings[discordId]
				}
				if (item.state.preview) item.state.preview.invalidated = true
				await save(guild.id, item)
			} catch (caught) {
			const error = getError(caught); item.state = previous; throw error }
			finally { item.busy = false }
			return view(item)
		},
		async apply(guild: D.Guild, actor: T.Actor | undefined, body: ApplyBody) {
			const item = await entry(guild.id)
			const preview = item.state.preview
			if (!preview || preview.id !== body?.previewId || preview.invalidated || now() - preview.generatedAt > 15 * 60 * 1000) throw problem(409, 'Предпросмотр устарел. Получите новый состав.')
			if (!Array.isArray(body.discordIds) || !body.discordIds.length || body.discordIds.length > preview.rows.length || new Set(body.discordIds).size !== body.discordIds.length) throw problem(400, 'Выберите участников для применения.')
			const selectedCandidates = body.discordIds.map(id => preview.rows.find(row => row.discordId === id && row.status === 'change'))
			if (selectedCandidates.some(row => !row)) throw problem(400, 'Можно применить только строки без конфликтов и блокировок.')
			const selected = selectedCandidates.filter((row): row is NonNullable<typeof row> => Boolean(row))
			return start(guild, actor, 'apply', async current => {
				if (current.state.preview !== preview || preview.invalidated) throw problem(409, 'Решения или предпросмотр изменились. Получите новый состав.')
				preview.invalidated = true
				current.state.run.total = selected.length
				await save(guild.id, current)
				const fresh = await snapshot(guild, current.state.decisions)
				if (fresh.source !== preview.source) throw problem(409, 'Изменён сервер или персонаж Majestic. Получите новый предпросмотр.')
				if (selected.some(row => describe(row) !== describe(fresh.rows.find((next) => next.discordId === row.discordId) || {}))) throw problem(409, 'Состав, ники или роли изменились. Получите новый предпросмотр.')
				for (const row of selected) {
					if (current.state.run.stopRequested) break
					const result: SyncResult = { discordId: row.discordId, status: 'applying', before: row.currentNickname, nickname: row.nickname, addRoles: row.addRoles, removeRoles: row.removeRoles }
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
						const payload: D.GuildMemberEditOptions = { reason: `Majestic sync by ${actor?.id || actor}; run ${current.state.run.id}` }
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
		async stop(guild: D.Guild, actor: T.Actor | undefined) {
			const item = await entry(guild.id)
			if (item.busy && item.state.run?.status === 'running') {
				await audit(actor, 'majestic.stop', guild.id)
				item.state.run!.stopRequested = true
				await save(guild.id, item)
			}
			return view(item)
		},
		async wait(guild: D.Guild) { await (await entry(guild.id)).task }
	}
}

export { createMajesticSync }
