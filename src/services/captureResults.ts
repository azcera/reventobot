import { ComponentType, ContainerBuilder, TextDisplayBuilder, escapeMarkdown, type Client } from 'discord.js'
import type { Pool } from 'pg'
import type { Env } from '../types'
import type { BindingMember, Decisions, RawWar, War } from '../features/capture/familyWarTypes'
import { battleSummary, bindingIndex, FAMILY_ID, normalizeWar, rulesFromEnv, SERVER } from '../features/capture/familyWarData'
import { loadDiscordMembers } from './discordMembers'

interface CaptureNotice { attack: boolean; enemy: string; startTime: string; zone: string }
interface NoticeRow { message_id: string; channel_id: string; guild_id: string; notice: CaptureNotice; api_id: string | null; version: string | null }
const RESULT_ID = 1698001
const SCHEMA = `CREATE TABLE IF NOT EXISTS telegram_capture_results (
	message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, guild_id TEXT NOT NULL,
	notice JSONB NOT NULL, version TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE telegram_capture_results ADD COLUMN IF NOT EXISTS api_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS telegram_capture_results_api_id
	ON telegram_capture_results (guild_id, api_id) WHERE api_id IS NOT NULL`

export function matchesCapture(notice: CaptureNotice, war: War) {
	const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(notice.startTime)
	if (!match) return false
	const [, day, month, year, hour, minute] = match
	const time = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+03:00`)
	const name = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
	const delay = Math.floor(war.startAt / 60000) - Math.floor(time / 60000)
	const ourSide = notice.attack ? war.raw.attackersId : war.raw.defendersId
	return delay >= 0 && delay <= 20 && ourSide === FAMILY_ID && name(war.enemy) === name(notice.enemy)
}

export function captureResultText(war: War, members: Iterable<BindingMember> = [], decisions: Decisions = {}) {
	const battle = battleSummary(war)
	const bindings = bindingIndex(members, decisions)
	const stat = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : -1
	const players = (war.raw.players?.[String(FAMILY_ID)] || []).filter(player => player &&
		Number.isSafeInteger(player.id) && player.id > 0 && (player.familyId === undefined || player.familyId === FAMILY_ID))
		.slice().sort((a, b) => stat(b.kills) - stat(a.kills) || stat(b.damage) - stat(a.damage) || a.id - b.id)
	const lines = players.map(player => {
		const ids = bindings.get(String(player.id)) || []
		const name = escapeMarkdown(String(player.name || 'Неизвестный игрок').replace(/\s+/g, ' ').slice(0, 150)).replace(/@/g, '＠')
		const identity = `${name} / ${ids.length === 1 ? `<@${ids[0]}>` : player.id}`
		const star = battle.damageMvp && player.damage === battle.damageMvp.damage ? ' ⭐' : ''
		return `${identity} — **${stat(player.damage) < 0 ? '—' : player.damage} | ${stat(player.kills) < 0 ? '—' : player.kills}**${star}`
	})
	return `### ${war.status === 'finished' ? `Результат капта: ${battle.result}` : 'Капт не завершён'}\nУрон | Киллы\n${lines.join('\n') || 'Состав пока не получен.'}`
}

export function createCaptureResults({ client, pool, env = process.env, fetchImpl = fetch, logger = console }: {
	client: Client; pool: Pool; env?: Env; fetchImpl?: typeof fetch; logger?: Pick<Console, 'error'>
}) {
	let schema: Promise<unknown> | undefined, timer: ReturnType<typeof setInterval> | undefined, polling: Promise<void> | undefined
	const ensureSchema = () => schema ||= pool.query(SCHEMA).catch(error => { schema = undefined; throw error })
	async function track(message: { id: string; channelId: string; guildId: string | null }, notice: CaptureNotice) {
		if (!message.guildId) return
		await ensureSchema()
		await pool.query(`INSERT INTO telegram_capture_results (message_id, channel_id, guild_id, notice)
			VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (message_id) DO NOTHING`,
			[message.id, message.channelId, message.guildId, JSON.stringify(notice)])
	}
	async function pollOnce() {
		const key = env.FAMILY_WARS_API_KEY?.trim()
		if (!key) return
		await ensureSchema()
		const rows = (await pool.query<NoticeRow>(`SELECT * FROM telegram_capture_results
			WHERE guild_id = $1 AND api_id IS NULL AND created_at > NOW() - INTERVAL '7 days'`, [env.GUILD_ID])).rows
		if (!rows.length) return
		const response = await fetchImpl(`https://api.majestic-files.net/v1/ext/family-wars/${SERVER}`, {
			headers: { Accept: 'application/json', 'x-api-key': key }, signal: AbortSignal.timeout(20000), redirect: 'error'
		})
		if (!response.ok) throw new Error(`Family Wars HTTP ${response.status}`)
		const data = await response.json() as { code: number; status: boolean; result?: { serverId: string; captures: RawWar[] } }
		if (data.code !== 200 || data.status !== true || data.result?.serverId !== SERVER || !Array.isArray(data.result.captures)) throw new Error('Неожиданный формат Family Wars API.')
		const wars = data.result.captures.map(raw => normalizeWar(raw, rulesFromEnv(env))).filter((war): war is War => !!war && war.status === 'finished' && !war.neutral)
		const claimed = new Set((await pool.query<{ api_id: string }>(`SELECT api_id FROM telegram_capture_results
			WHERE guild_id = $1 AND api_id = ANY($2::bigint[])`, [env.GUILD_ID, wars.map(war => war.apiId)])).rows.map(row => String(row.api_id)))
		let bindings: Promise<{ members: Iterable<BindingMember>; decisions: Decisions }> | undefined
		async function loadBindings(guildId: string) {
			const guild = await client.guilds.fetch(guildId)
			const members = await loadDiscordMembers(guild)
			const exists = await pool.query("SELECT to_regclass('public.majestic_sync_state') AS name")
			const decisions: Decisions = exists.rows[0]?.name
				? (await pool.query('SELECT value FROM majestic_sync_state WHERE guild_id = $1', [guildId])).rows[0]?.value?.decisions || {} : {}
			return { members: [...members.values()], decisions }
		}
		// Match both directions before binding: one announcement must not steal another's battle.
		const candidates = rows.map(row => ({ row, wars: wars.filter(war => !claimed.has(String(war.apiId)) && matchesCapture(row.notice, war)) }))
		for (const { row, wars: matches } of candidates) {
			try {
				if (matches.length !== 1) continue
				const war = matches[0]
				if (candidates.filter(candidate => candidate.wars.some(match => match.apiId === war.apiId)).length !== 1) continue
				bindings ||= loadBindings(row.guild_id)
				const linked = await bindings
				const version = captureResultText(war, linked.members, linked.decisions)
				const channel = await client.channels.fetch(row.channel_id)
				if (!channel || !('guildId' in channel) || channel.guildId !== row.guild_id || !channel.isTextBased()) continue
				const message = await channel.messages.fetch(row.message_id)
				if (message.author.id !== client.user?.id) continue
				const result = battleSummary(war).result
				const color = result === 'Неопределено' ? undefined : result === 'Победа' ? 0x57f287 : 0xed4245
				const components = message.components.map(component => component.toJSON()).filter(component => component.id !== RESULT_ID)
					.map(component => component.type === ComponentType.Container && color !== undefined ? { ...component, accent_color: color } : component)
				const container = new ContainerBuilder().setId(RESULT_ID).setAccentColor(color)
				// Discord limits an individual text display to 4000 characters.
				let chunk = ''
				for (const line of version.split('\n')) {
					if (chunk.length + line.length + 1 > 4000) {
						container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk))
						chunk = ''
					}
					chunk += (chunk ? '\n' : '') + line
				}
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk))
				components.push(container.toJSON())
				await message.edit({ components, allowedMentions: { parse: [] } })
				await pool.query(`UPDATE telegram_capture_results SET api_id = $2, version = $3
					WHERE message_id = $1 AND api_id IS NULL`, [row.message_id, war.apiId, version])
			} catch (error) { logger.error('[CaptureResults]', row.message_id, error) }
		}
	}
	function poll() {
		return polling ||= pollOnce().finally(() => { polling = undefined })
	}
	return {
		track, poll,
		start() {
			if (timer) return
			const run = () => { void poll().catch(error => logger.error('[CaptureResults]', error)) }
			run()
			timer = setInterval(run, 60000)
			timer.unref?.()
		},
		async stop() { clearInterval(timer); timer = undefined; await polling?.catch(() => {}) }
	}
}
