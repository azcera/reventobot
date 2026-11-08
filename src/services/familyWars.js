const { createHash } = require('node:crypto')
const { PermissionFlagsBits, MessageFlags, TextDisplayBuilder } = require('discord.js')
const { SERVER, rulesFromEnv, nextPollAt, moscowDay, normalizeWar, canAnnounce, bindingIndex } = require('../features/capture/familyWarData')
const { announcement, registrationMessage } = require('../features/capture/familyWarMessages')

const FAMILY_WAR_SCHEMA = `CREATE TABLE IF NOT EXISTS family_wars (
	guild_id TEXT NOT NULL, war_key TEXT NOT NULL, data JSONB NOT NULL,
	registration JSONB NOT NULL DEFAULT '{}', announcement_id TEXT,
	announcement_channel_id TEXT, announcement_state TEXT, registration_id TEXT,
	registration_channel_id TEXT, registration_state TEXT,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (guild_id, war_key)
)`

function hasButton(message, marker) {
	const find = components => (components || []).some(component =>
		(component.customId || component.custom_id) === marker || find(component.components))
	return find(message.components)
}

function createFamilyWars({ client, pool, store, env = process.env, fetchImpl = fetch,
	now = Date.now, logger = console, setTimer = setTimeout, clearTimer = clearTimeout }) {
	const locks = new Map()
	let schema, timer, polling, stopped = true
	const rules = rulesFromEnv(env)
	function ensureSchema() {
		if (!schema) schema = pool.query(FAMILY_WAR_SCHEMA).catch(error => { schema = null; throw error })
		return schema
	}
	async function locked(key, work) {
		const previous = locks.get(key) || Promise.resolve()
		const next = previous.catch(() => {}).then(work)
		locks.set(key, next)
		try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
	}
	async function load(key, guildId) {
		return (await pool.query('SELECT * FROM family_wars WHERE war_key = $1 AND guild_id = $2', [key, guildId])).rows[0]
	}
	async function save(row) {
		await pool.query(`INSERT INTO family_wars (guild_id, war_key, data, registration, announcement_id,
			announcement_channel_id, announcement_state, registration_id, registration_channel_id, registration_state)
			VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10)
			ON CONFLICT (guild_id, war_key) DO UPDATE SET data=EXCLUDED.data, registration=EXCLUDED.registration,
			announcement_id=EXCLUDED.announcement_id, announcement_channel_id=EXCLUDED.announcement_channel_id,
			announcement_state=EXCLUDED.announcement_state, registration_id=EXCLUDED.registration_id,
			registration_channel_id=EXCLUDED.registration_channel_id, registration_state=EXCLUDED.registration_state, updated_at=NOW()`,
			[row.guild_id, row.war_key, JSON.stringify(row.data), JSON.stringify(row.registration),
				row.announcement_id || null, row.announcement_channel_id || null, row.announcement_state || null,
				row.registration_id || null, row.registration_channel_id || null, row.registration_state || null])
	}
	async function decisions(guildId) {
		const exists = await pool.query("SELECT to_regclass('public.majestic_sync_state') AS name")
		if (!exists.rows[0]?.name) return {}
		return (await pool.query('SELECT value FROM majestic_sync_state WHERE guild_id = $1', [guildId])).rows[0]?.value?.decisions || {}
	}
	function url(row) {
		return row.registration_id ? `https://discord.com/channels/${row.guild_id}/${row.registration_channel_id}/${row.registration_id}` : null
	}
	async function channel(id, guildId) {
		if (!id) throw new Error('Не задан канал объявлений или регистраций.')
		const result = await client.channels.fetch(id)
		if (!result?.send || result.guildId !== guildId) throw new Error('Канал недоступен или находится на другом сервере.')
		return result
	}
	async function deliver(row, kind, payload) {
		const target = await channel(row[`${kind}_channel_id`], row.guild_id)
		const marker = kind === 'announcement' ? `capt_api_RU8_${row.data.apiId}` : `war_join_RU8_${row.data.apiId}`
		if (row[`${kind}_state`] === 'sending') {
			const recent = await target.messages.fetch({ limit: 100 })
			const found = [...recent.values()].find(message => message.author.id === client.user.id && hasButton(message, marker))
			if (!found) throw new Error(`Неопределённый результат отправки ${row.war_key}: проверьте канал; автоматический повтор остановлен во избежание дубля.`)
			row[`${kind}_id`] = found.id
			row[`${kind}_state`] = 'sent'
			await save(row)
			return
		}
		row[`${kind}_state`] = 'sending'
		await save(row)
		try {
			const nonce = createHash('sha256').update(`${row.guild_id}:${row.war_key}:${kind}`).digest('hex').slice(0, 24)
			const message = await target.send({ ...payload, nonce, enforceNonce: true })
			row[`${kind}_id`] = message.id
			row[`${kind}_state`] = 'sent'
			await save(row)
		} catch (error) {
			// These errors confirm that Discord did not create a message; other failures are ambiguous.
			if ([50001, 50013, 50035].includes(error.code)) {
				row[`${kind}_state`] = null
				await save(row)
			}
			throw error
		}
	}
	async function edit(row, kind, payload) {
		const target = await channel(row[`${kind}_channel_id`], row.guild_id)
		const message = await target.messages.fetch(row[`${kind}_id`])
		await message.edit(payload)
	}
	async function refresh(row, guild, bindings) {
		if (row.registration_id) await edit(row, 'registration', registrationMessage(row.data, row.registration, guild, bindings, store, now()))
		const version = JSON.stringify([row.data.startAt, row.data.status, row.data.neutral, row.data.closed, row.data.enemy, row.data.map, row.data.zone, url(row)])
		if (row.announcement_id && row.registration.announcementVersion !== version) {
			await edit(row, 'announcement', announcement(row.data, url(row), now()))
			row.registration.announcementVersion = version
			await save(row)
		}
	}
	function noteRoster(row) {
		row.registration.seen ||= {}
		for (const player of row.data.roster) row.registration.seen[player.static] ??= now()
	}
	async function fetchWars() {
		const apiKey = env.FAMILY_WARS_API_KEY?.trim()
		if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey)) throw new Error('Заполните FAMILY_WARS_API_KEY в .env или Secrets: нужен ключ без пробелов и переносов строк.')
		const headers = { Accept: 'application/json', 'x-api-key': apiKey }
		const response = await fetchImpl(`https://api.majestic-files.net/v1/ext/family-wars/${SERVER}`, {
			headers, signal: AbortSignal.timeout(20000), redirect: 'error'
		})
		if (!response.ok) throw new Error(`Family Wars HTTP ${response.status}${[401, 403].includes(response.status) ? ': доступ отклонён. Проверьте требования API к авторизации и доступ с сервера бота.' : ''}`)
		const data = await response.json()
		if (data.code !== 200 || data.status !== true || data.result?.serverId !== SERVER || !Array.isArray(data.result?.captures)) throw new Error('Неожиданный формат Family Wars API.')
		return data.result.captures
	}
	async function pollOnce() {
		const moscow = new Date(now() + 3 * 3600000)
		const minute = moscow.getUTCHours() * 60 + moscow.getUTCMinutes()
		if (minute < 900 || minute > 1290) return
		await ensureSchema()
		const captures = await fetchWars()
		const guild = await client.guilds.fetch(env.GUILD_ID)
		let bindings, rosterLoaded = false
		for (const raw of captures) {
			if (raw?.defendersId !== 1698 && raw?.attackersId !== 1698) continue
			try {
				await locked(`${guild.id}:${SERVER}:${raw.id}`, async () => {
					const key = `${SERVER}:${raw.id}`
					const previous = await load(key, guild.id)
					const war = normalizeWar(raw, rules, previous?.data, now())
					if (!war) return
					const row = previous || { guild_id: guild.id, war_key: key, registration: { joins: {}, declined: {}, seen: {}, sortMode: 'priority', page: 0 } }
					row.data = war
					noteRoster(row)
					await save(row)
					if (!row.announcement_id && (canAnnounce(war, now()) || row.announcement_state === 'sending')) {
						row.announcement_channel_id ||= store.getSetting('CAPT_INFO_CHANNEL_ID')
						const payload = announcement(war, url(row), now())
						if (canAnnounce(war, now())) {
							payload.components[0].addTextDisplayComponents(new TextDisplayBuilder().setContent('||@everyone||'))
							payload.allowedMentions = { parse: ['everyone'] }
						}
						await deliver(row, 'announcement', payload)
					}
					if (row.registration_id || row.registration_state === 'sending') {
						if (!rosterLoaded) { await guild.members.fetch({ time: 30000 }); bindings = await decisions(guild.id); rosterLoaded = true }
						if (!row.registration_id) await deliver(row, 'registration', registrationMessage(war, row.registration, guild, bindings, store, now()))
					}
					// Bindings and role priorities can change even when API data stays identical.
					await refresh(row, guild, bindings || {})
				})
			} catch (error) { logger.error(`[FamilyWars] ${raw.id}: ${error.message}`) }
		}
	}
	function poll() {
		if (!polling) polling = pollOnce().finally(() => { polling = null })
		return polling
	}
	function schedule() {
		if (stopped) return
		timer = setTimer(async () => {
			try { await poll() } catch (error) { logger.error('[FamilyWars] Опрос не выполнен:', error.message) }
			finally { schedule() }
		}, nextPollAt(now()) - now())
		timer.unref?.()
	}
	async function createTestRegistration(message) {
		if (!message.guild || message.guild.id !== env.GUILD_ID) return
		const admin = message.member.permissions.has(PermissionFlagsBits.Administrator) ||
			store.roleIds('ADMIN_ROLES').some(id => message.member.roles.cache.has(id))
		if (!admin) return message.reply('Недостаточно прав.')
		await ensureSchema()
		const captures = await fetchWars()
		const wars = captures.map(raw => normalizeWar(raw, rules, null, now())).filter(war =>
			war && war.closed && !war.neutral && war.startAt <= now())
		wars.sort((a, b) => b.startAt - a.startAt || b.apiId - a.apiId)
		let source = wars[0]
		if (!source) return message.reply('API не вернул ни одного завершённого капта нашей семьи.')
		const previous = await load(source.key, message.guild.id)
		source = normalizeWar(source.raw, rules, previous?.data, now())
		if (!source.rosterUpdatedAt) return message.reply('Состав последнего завершённого капта неизвестен: API и база не содержат снимка для проверки.')
		const key = `${SERVER}:${message.id}`
		return locked(`${message.guild.id}:${key}`, async () => {
			let row = await load(key, message.guild.id)
			if (!row) row = {
				guild_id: message.guild.id, war_key: key,
				data: { ...source, key, apiId: message.id, closed: false, startAt: now(),
					testSource: { apiId: source.apiId, startAt: source.startAt } },
				registration: { joins: {}, declined: {}, seen: {}, sortMode: 'priority', page: 0 },
				registration_channel_id: store.getSetting('PLUS_CHANNEL_ID')
			}
			await message.guild.members.fetch({ time: 30000 })
			const bindings = await decisions(message.guild.id)
			noteRoster(row)
			if (!row.registration_id) await deliver(row, 'registration', registrationMessage(row.data, row.registration, message.guild, bindings, store, now()))
			return message.reply(`Тестовая регистрация по капту №${source.apiId}: ${url(row)}`)
		})
	}
	async function handle(interaction) {
		const match = /^(capt_api|war_join|war_leave|war_sort|war_page)_RU8_([1-9]\d*)(?:_(-?\d+))?$/.exec(interaction.customId)
		if (!match || !interaction.guild || interaction.guild.id !== env.GUILD_ID) return
		const create = match[1] === 'capt_api'
		try {
			if (!create) await interaction.deferUpdate()
			else await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		} catch { return }
		const respond = content => create ? interaction.editReply({ content }) : interaction.followUp({ content, flags: MessageFlags.Ephemeral })
		try {
			await ensureSchema()
			await locked(`${interaction.guild.id}:${SERVER}:${match[2]}`, async () => {
				const row = await load(`${SERVER}:${match[2]}`, interaction.guild.id)
				if (!row) return respond('Этот капт отсутствует в базе.')
				if ((create ? row.announcement_id : row.registration_id) !== interaction.message.id) return respond('Эта кнопка не принадлежит актуальному сообщению капта.')
				const admin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
					store.roleIds('ADMIN_ROLES').some(id => interaction.member.roles.cache.has(id))
				if ((create || match[1] === 'war_sort') && !admin) return respond('Недостаточно прав.')
				if (create && row.registration_id) return respond(`Регистрация уже создана: ${url(row)}`)
				if ((create || ['war_join', 'war_leave'].includes(match[1])) &&
					(row.data.closed || row.data.neutral || moscowDay(row.data.startAt) < moscowDay(now()))) return respond('Капт завершён, устарел или относится к нейтральной территории.')
				const guild = interaction.guild
				await guild.members.fetch({ time: 30000 })
				const bindings = await decisions(guild.id)
				const reg = row.registration
				reg.joins ||= {}; reg.declined ||= {}
				const userId = interaction.user.id
				if (match[1] === 'war_join') {
					reg.joins[userId] ||= { joinedAt: now() }
					delete reg.declined[userId]
				} else if (match[1] === 'war_leave') {
					delete reg.joins[userId]
					const index = bindingIndex(guild.members.cache.values(), bindings)
					if (row.data.roster.some(player => index.get(player.static)?.length === 1 && index.get(player.static)[0] === userId)) reg.declined[userId] = now()
				} else if (match[1] === 'war_sort') reg.sortMode = reg.sortMode === 'time' ? 'priority' : 'time'
				else if (match[1] === 'war_page') reg.page = Math.max(0, Number(match[3]) || 0)
				noteRoster(row)
				await save(row)
				if (create) {
					row.registration_channel_id ||= store.getSetting('PLUS_CHANNEL_ID')
					await deliver(row, 'registration', registrationMessage(row.data, reg, guild, bindings, store, now()))
				}
				await refresh(row, guild, bindings)
				if (create) await respond(`Регистрация: ${url(row)}`)
			})
		} catch (error) {
			logger.error('[FamilyWars] Ошибка кнопки:', error.message)
			await respond('Не удалось обновить капт. Проверьте журнал бота; повторное нажатие не создаёт вторую регистрацию.').catch(() => {})
		}
	}
	return {
		poll, handle, createTestRegistration,
		start() { if (stopped) { stopped = false; schedule() } },
		async stop() { stopped = true; clearTimer(timer); await polling?.catch(() => {}) }
	}
}

module.exports = { FAMILY_WAR_SCHEMA, createFamilyWars }
