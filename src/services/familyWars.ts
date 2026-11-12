import { getError } from '../utils/errors'
import type { WarRow, RawWar, War, Decisions } from '../features/capture/familyWarTypes'
interface FamilyWarsOptions { client: D.Client; pool: Pg.Pool; store: T.Store; env?: T.Env; fetchImpl?: typeof fetch; now?: () => number; logger?: Pick<Console, 'error'>; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; sleep?: typeof delay }
type MessageKind = 'announcement' | 'registration'
type WarPayload = (ReturnType<typeof announcement> | ReturnType<typeof registrationMessage>) & Pick<D.MessageCreateOptions, 'files'>
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { loadDiscordMembers } from './discordMembers'
import { PermissionFlagsBits, MessageFlags, TextDisplayBuilder } from 'discord.js'
import { SERVER, rulesFromEnv, nextPollAt, normalizeWar, canAnnounce, registrationClosed, bindingIndex } from '../features/capture/familyWarData'
import { announcement, registrationMessage } from '../features/capture/familyWarMessages'

const FAMILY_WAR_SCHEMA = `CREATE TABLE IF NOT EXISTS family_wars (
	guild_id TEXT NOT NULL, war_key TEXT NOT NULL, data JSONB NOT NULL,
	registration JSONB NOT NULL DEFAULT '{}', announcement_id TEXT,
	announcement_channel_id TEXT, announcement_state TEXT, registration_id TEXT,
	registration_channel_id TEXT, registration_state TEXT,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (guild_id, war_key)
)`

function hasButton(message: D.Message, marker: string) {
	const find = (components: unknown): boolean => Array.isArray(components) && components.some((component: unknown) => {
		if (!component || typeof component !== 'object') return false
		return ('customId' in component && component.customId === marker) || ('custom_id' in component && component.custom_id === marker) || ('components' in component && find(component.components))
	})
	return find(message.components)
}

function createFamilyWars({ client, pool, store, env = process.env, fetchImpl = fetch,
	now = Date.now, logger = console, setTimer = setTimeout, clearTimer = clearTimeout, sleep = delay }: FamilyWarsOptions) {
	const locks = new Map<string, Promise<unknown>>()
	const loadMembers = (guild: D.Guild) => loadDiscordMembers(guild, { now, sleep })
	let schema: Promise<unknown> | null = null, timer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | null = null, polling: Promise<void> | null = null, stopped = true
	const rules = rulesFromEnv(env)
	function ensureSchema() {
		if (!schema) schema = pool.query(FAMILY_WAR_SCHEMA).catch(error => { schema = null; throw error })
		return schema
	}
	async function locked<R>(key: string, work: () => Promise<R>): Promise<R> {
		const previous = locks.get(key) || Promise.resolve()
		const next = previous.catch(() => {}).then(work)
		locks.set(key, next)
		try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
	}
	async function load(key: string, guildId: string) {
		return (await pool.query<WarRow>('SELECT * FROM family_wars WHERE war_key = $1 AND guild_id = $2', [key, guildId])).rows[0]
	}
	async function save(row: WarRow) {
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
	async function decisions(guildId: string): Promise<Decisions> {
		const exists = await pool.query("SELECT to_regclass('public.majestic_sync_state') AS name")
		if (!exists.rows[0]?.name) return {}
		return (await pool.query('SELECT value FROM majestic_sync_state WHERE guild_id = $1', [guildId])).rows[0]?.value?.decisions || {}
	}
	function url(row: WarRow) {
		return row.registration_id ? `https://discord.com/channels/${row.guild_id}/${row.registration_channel_id}/${row.registration_id}` : null
	}
	async function channel(id: string | null | undefined, guildId: string) {
		if (!id) throw new Error('Не задан канал объявлений или регистраций.')
		const result = await client.channels.fetch(id)
		if (!result || !('send' in result) || !('guildId' in result) || result.guildId !== guildId) throw new Error('Канал недоступен или находится на другом сервере.')
		return result
	}
	async function deliver(row: WarRow, kind: MessageKind, payload: WarPayload) {
		const target = await channel(row[`${kind}_channel_id`], row.guild_id)
		const marker = kind === 'announcement' ? `capt_api_RU8_${row.data.apiId}` : `war_join_RU8_${row.data.apiId}`
		if (row[`${kind}_state`] === 'sending') {
			const recent = await target.messages.fetch({ limit: 100 })
			const found = [...recent.values()].find((message: D.Message) => message.author.id === client.user!.id && hasButton(message, marker))
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
		} catch (caught) {
			const error = getError(caught);
			// These errors confirm that Discord did not create a message; other failures are ambiguous.
			if ([50001, 50013, 50035].includes(Number(error.code))) {
				row[`${kind}_state`] = null
				await save(row)
			}
			throw error
		}
	}
	async function edit(row: WarRow, kind: MessageKind, payload: WarPayload) {
		const target = await channel(row[`${kind}_channel_id`], row.guild_id)
		const messageId = row[`${kind}_id`]
		if (!messageId) throw new Error('Сообщение капта отсутствует')
		const message = await target.messages.fetch(messageId)
		await message.edit('files' in payload && payload.files ? { ...payload, attachments: [] } : payload)
	}
	async function refresh(row: WarRow, guild: D.Guild, bindings: Decisions) {
		if (row.registration_id && !row.registration.closedAt) {
			await edit(row, 'registration', registrationMessage(row.data, row.registration, guild, bindings, store, now()))
			if (registrationClosed(row.data, now())) {
				row.registration.closedAt = now()
				await save(row)
			}
		}
		const payload = announcement(row.data, url(row), now(), guild.members.cache.values(), bindings, store.text.bind(store))
		const version = JSON.stringify(payload.components.map(component => component.toJSON()))
		if (row.announcement_id && !row.registration.announcementFinished && row.registration.announcementVersion !== version) {
			await edit(row, 'announcement', payload)
			row.registration.announcementVersion = version
			if (row.data.closed) row.registration.announcementFinished = true
			await save(row)
		}
	}
	function scheduleClosures() {
		return locked('registration-closures', async () => {
			if (closeTimer) { clearTimer(closeTimer); closeTimer = null }
			await ensureSchema()
			const rows = (await pool.query<WarRow>("SELECT * FROM family_wars WHERE guild_id = $1 AND registration_id IS NOT NULL AND NOT (registration ? 'closedAt')", [env.GUILD_ID])).rows
			let next = Infinity
			for (const snapshot of rows) {
				if (snapshot.data.testSource || snapshot.registration.closedAt || !snapshot.registration_id) continue
				const deadline = snapshot.data.startAt - 3 * 60000
				if (deadline > now() && !snapshot.data.closed && !snapshot.data.neutral) { next = Math.min(next, deadline); continue }
				await locked(`${snapshot.guild_id}:${snapshot.war_key}`, async () => {
					const row = await load(snapshot.war_key, snapshot.guild_id)
					if (!row || row.registration.closedAt || !registrationClosed(row.data, now())) return
					const guild = await client.guilds.fetch(row.guild_id)
					await refresh(row, guild, await decisions(guild.id))
				})
			}
			if (!stopped && Number.isFinite(next)) {
				closeTimer = setTimer(() => {
					return scheduleClosures().catch(error => logger.error('[FamilyWars] Закрытие регистрации:', error.message))
				}, Math.max(0, next - now()))
				closeTimer.unref?.()
			}
		}).catch(error => {
			if (!stopped && !closeTimer) closeTimer = setTimer(() => {
				closeTimer = null
				scheduleClosures().catch(error => logger.error('[FamilyWars] Закрытие регистрации:', error.message))
			}, 60000)
			throw error
		})
	}
	function noteRoster(row: WarRow) {
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
		const raw: unknown = await response.json()
		if (!raw || typeof raw !== 'object') throw new Error('Неожиданный формат Family Wars API.')
		const data = raw as { code: number; status: boolean; result?: { serverId: string; captures: RawWar[] } }
		if (data.code !== 200 || data.status !== true || data.result?.serverId !== SERVER || !Array.isArray(data.result?.captures)) throw new Error('Неожиданный формат Family Wars API.')
		return data.result!.captures
	}
	async function pollOnce() {
		const moscow = new Date(now() + 3 * 3600000)
		const minute = moscow.getUTCHours() * 60 + moscow.getUTCMinutes()
		if (minute < 900 || minute > 1290) return
		await ensureSchema()
		const captures = await fetchWars()
		const guild = await client.guilds.fetch(env.GUILD_ID!)
		let bindings: Decisions = {}, rosterLoaded = false
		for (const raw of captures) {
			if (raw?.defendersId !== 1698 && raw?.attackersId !== 1698) continue
			try {
				await locked(`${guild.id}:${SERVER}:${raw.id}`, async () => {
					const key = `${SERVER}:${raw.id}`
					const previous = await load(key, guild.id)
					if (previous?.data.closed && (!previous.announcement_id || previous.registration.announcementFinished) &&
						(!previous.registration_id || previous.registration.closedAt)) return
					const war = normalizeWar(raw, rules, previous?.data, now())
					if (!war) return
					const row: WarRow = previous || { data: war, guild_id: guild.id, war_key: key, registration: { joins: {}, declined: {}, seen: {}, sortMode: 'priority', page: 0 } }
					row.data = war
					noteRoster(row)
					await save(row)
					if (!row.announcement_id && (canAnnounce(war, now()) || row.announcement_state === 'sending')) {
						row.announcement_channel_id ||= String(store.getSetting('CAPT_INFO_CHANNEL_ID'))
						const payload = announcement(war, url(row), now(), [], {}, store.text.bind(store))
						if (canAnnounce(war, now())) {
							payload.allowedMentions = { parse: ['everyone'] }
						}
						await deliver(row, 'announcement', payload)
					}
					if ((row.registration_id && !row.registration.closedAt) || row.registration_state === 'sending' ||
						(war.status === 'finished' && row.announcement_id && !row.registration.announcementFinished)) {
						if (!rosterLoaded) { await loadMembers(guild); bindings = await decisions(guild.id); rosterLoaded = true }
						if (!row.registration_id && row.registration_state === 'sending') await deliver(row, 'registration', registrationMessage(war, row.registration, guild, bindings, store, now()))
					}
					// Bindings and role priorities can change even when API data stays identical.
					await refresh(row, guild, bindings || {})
				})
			} catch (caught) {
			const error = getError(caught); logger.error(`[FamilyWars] ${raw.id}: ${error.message}`) }
		}
	}
	function poll() {
		if (!polling) polling = pollOnce().finally(async () => {
			try { await scheduleClosures() } finally { polling = null }
		})
		return polling
	}
	function schedule() {
		if (stopped) return
		timer = setTimer(async () => {
			try { await poll() } catch (caught) {
			const error = getError(caught); logger.error('[FamilyWars] Опрос не выполнен:', error.message) }
			finally { schedule() }
		}, nextPollAt(now()) - now())
		timer.unref?.()
	}
	async function createTestRegistration(message: D.Message<true>, { preview = false, attackOnly = false } = {}) {
		if (!message.member || !message.guild || message.guild.id !== env.GUILD_ID) return
		const member = message.member
		const admin = member.permissions.has(PermissionFlagsBits.Administrator) ||
			store.roleIds('ADMIN_ROLES').some(id => member.roles.cache.has(id))
		if (!admin) return message.reply('Недостаточно прав.')
		await ensureSchema()
		const captures = await fetchWars()
		const wars = captures.map(raw => normalizeWar(raw, rules, null, now())).filter((war): war is War =>
			war !== null && war.status === 'finished' && !war.neutral && war.startAt <= now() && (!attackOnly || war.attack))
		wars.sort((a, b) => b.startAt - a.startAt || Number(b.apiId) - Number(a.apiId))
		let source = wars[0]
		if (!source) return message.reply(attackOnly ? 'API не вернул ни одного завершённого капта, где наша семья была атакующей.' : 'API не вернул ни одного завершённого капта нашей семьи.')
		const previous = await load(source.key, message.guild.id)
		source = normalizeWar(source.raw, rules, previous?.data, now())!
		if (preview) {
			await loadMembers(message.guild)
			const payload = announcement(source, null, now(), message.guild.members.cache.values(), await decisions(message.guild.id), store.text.bind(store))
			payload.components[0].addTextDisplayComponents(new TextDisplayBuilder().setContent(`🧪 Просмотр последнего завершённого капта №${source.apiId}.`))
			return message.reply(payload)
		}
		if (!source.rosterUpdatedAt) return message.reply('Состав последнего завершённого капта неизвестен: API и база не содержат снимка для проверки.')
		const key = `${SERVER}:${message.id}`
		return locked(`${message.guild.id}:${key}`, async () => {
			let row = await load(key, message.guild.id)
			if (!row) row = {
				guild_id: message.guild.id, war_key: key,
				data: { ...source, key, apiId: message.id, closed: false, startAt: now(),
					testSource: { apiId: source.apiId, startAt: source.startAt } },
				registration: { joins: {}, declined: {}, seen: {}, sortMode: 'priority', page: 0 },
				registration_channel_id: String(store.getSetting('PLUS_CHANNEL_ID'))
			}
			await loadMembers(message.guild)
			const bindings = await decisions(message.guild.id)
			noteRoster(row)
			if (!row.registration_id) await deliver(row, 'registration', registrationMessage(row.data, row.registration, message.guild, bindings, store, now()))
			return message.reply(`Тестовая регистрация по капту №${source.apiId}: ${url(row)}`)
		})
	}
	async function handle(interaction: D.ButtonInteraction<'cached'>) {
		const match = /^(capt_api|war_join|war_leave|war_sort|war_page)_RU8_([1-9]\d*)(?:_(-?\d+))?$/.exec(interaction.customId)
		if (!match || !interaction.guild || interaction.guild.id !== env.GUILD_ID) return
		const create = match[1] === 'capt_api'
		try {
			if (!create) await interaction.deferUpdate()
			else await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		} catch { return }
		const respond = (content: string) => create ? interaction.editReply({ content }) : interaction.followUp({ content, flags: MessageFlags.Ephemeral })
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
				if (row.registration.closedAt || registrationClosed(row.data, now())) return respond('Регистрация закрыта: до начала осталось не больше 3 минут, либо капт завершён, устарел или относится к нейтральной территории.')
				const guild = interaction.guild
				// Joining/leaving/sorting uses the cache maintained by GuildMembers events.
				if (create) await loadMembers(guild)
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
					if (row.data.roster.some(player => index.get(player.static)?.length === 1 && index.get(player.static)?.[0] === userId)) reg.declined[userId] = now()
				} else if (match[1] === 'war_sort') reg.sortMode = reg.sortMode === 'time' ? 'priority' : 'time'
				else if (match[1] === 'war_page') reg.page = Math.max(0, Number(match[3]) || 0)
				noteRoster(row)
				await save(row)
				if (create) {
					row.registration_channel_id ||= String(store.getSetting('PLUS_CHANNEL_ID'))
					await deliver(row, 'registration', registrationMessage(row.data, reg, guild, bindings, store, now()))
				}
				await refresh(row, guild, bindings)
				if (create) await respond(`Регистрация: ${url(row)}`)
			})
		} catch (caught) {
			const error = getError(caught);
			logger.error('[FamilyWars] Ошибка кнопки:', error.message)
			await respond('Не удалось обновить капт. Проверьте журнал бота; повторное нажатие не создаёт вторую регистрацию.').catch(() => {})
		} finally {
			await scheduleClosures().catch(error => logger.error('[FamilyWars] Закрытие регистрации:', error.message))
		}
	}
	return {
		poll, handle, createTestRegistration,
		start() {
			if (stopped) {
				stopped = false; schedule()
				scheduleClosures().catch(error => logger.error('[FamilyWars] Закрытие регистрации:', error.message))
			}
		},
		async stop() { stopped = true; clearTimer(timer); if (closeTimer) clearTimer(closeTimer); await polling?.catch(() => {}) }
	}
}

export { FAMILY_WAR_SCHEMA, createFamilyWars }
