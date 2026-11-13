import { ContainerBuilder, TextDisplayBuilder, escapeMarkdown, type Client } from 'discord.js'
import type { Pool } from 'pg'
import type { Env } from '../types'
import type { RawWar, War } from '../features/capture/familyWarTypes'
import { battleSummary, normalizeWar, rulesFromEnv, SERVER } from '../features/capture/familyWarData'

interface CaptureNotice { attack: boolean; enemy: string; startTime: string; zone: string }
interface NoticeRow { message_id: string; channel_id: string; guild_id: string; notice: CaptureNotice; version: string | null }
const RESULT_ID = 1698001
const SCHEMA = `CREATE TABLE IF NOT EXISTS telegram_capture_results (
	message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, guild_id TEXT NOT NULL,
	notice JSONB NOT NULL, version TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`

export function matchesCapture(notice: CaptureNotice, war: War) {
	const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(notice.startTime)
	if (!match) return false
	const [, day, month, year, hour, minute] = match
	const time = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+03:00`)
	const name = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
	return Math.floor(war.startAt / 60000) === Math.floor(time / 60000) &&
		war.attack === notice.attack && name(war.enemy) === name(notice.enemy) && String(war.zone) === notice.zone.trim()
}

export function captureResultText(war: War) {
	const battle = battleSummary(war)
	const label = (player: typeof battle.damageMvp, field: 'damage' | 'kills') => player
		? `${escapeMarkdown(player.name).replace(/@/g, '＠')} / ${player.id} — **${player[field]}**` : 'Неопределено'
	return `### Результат капта: ${battle.result}\nMVP по урону: ${label(battle.damageMvp, 'damage')}\nMVP по киллам: ${label(battle.killsMvp, 'kills')}`
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
			WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '7 days'`, [env.GUILD_ID])).rows
		if (!rows.length) return
		const response = await fetchImpl(`https://api.majestic-files.net/v1/ext/family-wars/${SERVER}`, {
			headers: { Accept: 'application/json', 'x-api-key': key }, signal: AbortSignal.timeout(20000), redirect: 'error'
		})
		if (!response.ok) throw new Error(`Family Wars HTTP ${response.status}`)
		const data = await response.json() as { code: number; status: boolean; result?: { serverId: string; captures: RawWar[] } }
		if (data.code !== 200 || data.status !== true || data.result?.serverId !== SERVER || !Array.isArray(data.result.captures)) throw new Error('Неожиданный формат Family Wars API.')
		const wars = data.result.captures.map(raw => normalizeWar(raw, rulesFromEnv(env))).filter((war): war is War => !!war && war.status === 'finished' && !war.neutral)
		for (const row of rows) {
			try {
				const matches = wars.filter(war => matchesCapture(row.notice, war))
				if (matches.length !== 1) continue
				const version = captureResultText(matches[0])
				if (row.version === version) continue
				const channel = await client.channels.fetch(row.channel_id)
				if (!channel || !('guildId' in channel) || channel.guildId !== row.guild_id || !channel.isTextBased()) continue
				const message = await channel.messages.fetch(row.message_id)
				if (message.author.id !== client.user?.id) continue
				const components = message.components.map(component => component.toJSON()).filter(component => component.id !== RESULT_ID)
				components.push(new ContainerBuilder().setId(RESULT_ID).addTextDisplayComponents(new TextDisplayBuilder().setContent(version)).toJSON())
				await message.edit({ components, allowedMentions: { parse: [] } })
				await pool.query('UPDATE telegram_capture_results SET version = $2 WHERE message_id = $1', [row.message_id, version])
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
