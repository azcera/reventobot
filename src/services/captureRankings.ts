import {
	ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
	TextDisplayBuilder, escapeMarkdown
} from 'discord.js'
import type { ButtonInteraction, Guild, SendableChannels, ThreadChannel } from 'discord.js'
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { fetchArchiveThreads } from '../features/archive/unusedArchives'
import {
	captureHistories, captureStats, rankCapturePlayers, type CaptureStats
} from '../features/capture/captureRanking'
import { enqueueCaptureEdit } from '../features/capture/captureMessageQueue'
import { normalizeWar, rulesFromEnv, SERVER } from '../features/capture/familyWarData'
import type { RawWar } from '../features/capture/familyWarTypes'
import type { MembershipSnapshot, Store } from '../types'
import { getError } from '../utils/errors'
import { fetchFinishedCaptures } from './finishedCaptures'
import { ContainerBuilder } from './markdownContainer'

const INTERVAL = 5 * 60000
const PAGE_SIZE = 15
const MARKER = 1698002
const PREFIX = 'capstats:'
const CAPTURE_KILL_WEIGHT = 'CAPTURE_RANK_KILL_WEIGHT'
const RANK_CHANNEL = 'CAPTURE_RANK_CHANNEL_ID'

export function createCaptureRankings({
	pool, store, env = process.env, fetchImpl = fetch
}: { pool: Pool; store: Store; env?: import('../types').Env; fetchImpl?: typeof fetch }) {
	let roster: MembershipSnapshot | undefined
	let loaded = false
	let histories = captureHistories([])
	let historicalLoaded = false
	let cached:
		| { weight: number; rows: ReturnType<typeof rankCapturePlayers>; statics: Map<string, number> }
		| undefined
	let timer: ReturnType<typeof setInterval> | undefined
	let pending: Promise<void> | undefined
	const clean = (value: string) =>
		escapeMarkdown(value.replace(/[\r\n<>]/g, ' ').slice(0, 100))
	const average = (value: number) => value.toLocaleString('ru-RU', {
		maximumFractionDigits: 2
	})
	function ranking() {
		const weight = Number(store.getSetting(CAPTURE_KILL_WEIGHT))
		if (!cached || weight !== cached.weight) {
			const rows = rankCapturePlayers(histories, roster?.statics ?? new Set(), weight)
			cached = { weight, rows, statics: new Map(rows.map(row => [row.staticId, row.position])) }
		}
		return cached
	}
	function updateRoster(snapshot: MembershipSnapshot) {
		roster = snapshot
		cached = undefined
	}
	function byDiscord(guild?: Guild) {
		const positions = new Map<string, number>()
		if (!guild) return positions
		const counts = new Map<string, number>()
		for (const staticId of roster?.linked.values() ?? [])
			counts.set(staticId, (counts.get(staticId) ?? 0) + 1)
		for (const [id, staticId] of roster?.linked ?? []) {
			const position = ranking().statics.get(staticId)
			if (guild.members.cache.has(id) && position && counts.get(staticId) === 1)
				positions.set(id, position)
		}
		return positions
	}
	function card(key: string, requested = 0) {
		const history = key === 'rank' ? undefined : histories.get(key)
		if (key !== 'rank' && !history?.length) return
		const { rows, statics } = ranking()
		const lines = history
			? history.map(game =>
				`<t:${Math.floor(game.at / 1000)}:d> · ${clean(game.enemy)} · ${game.attack ? 'Атака' : 'Защита'} · ${game.result} · ${game.damage ?? '—'} урона · ${game.kills ?? '—'} килл.`)
			: rows.map(player =>
				`**${player.position}.** ${clean(player.name)} · STATIC ${player.staticId} · ${player.captures} капт. · ${average(player.damage)} урона · ${average(player.kills)} килл. · MVP ${player.mvp}`)
		const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE))
		const page = Math.max(0, Math.min(requested, pages - 1))
		const list = lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).join('\n')
		const content = history
			? store.text('captureHistory.document', {
				player: clean(history[0].name), static: key, captures: history.length,
				mvp: history.reduce((total, game) => total + game.mvp, 0),
				position: statics.get(key) ?? '—', history: list, page: page + 1, pages
			})
			: store.text('captureRanking.document', {
				ranking: list || 'Пока нет игроков с результатами.',
				players: rows.length, page: page + 1, pages
			})
		const container = new ContainerBuilder().setId(MARKER)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
		if (pages > 1)
			container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`${PREFIX}${key}:${page - 1}`)
					.setLabel('Назад').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
				new ButtonBuilder().setCustomId(`${PREFIX}${key}:${page + 1}`)
					.setLabel('Далее').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)
			))
		return {
			fingerprint: createHash('sha256').update(JSON.stringify([content, lines])).digest('hex'),
			payload: {
				components: [container],
				flags: MessageFlags.IsComponentsV2 as const,
				allowedMentions: { parse: [] as [] }
			}
		}
	}
	async function withOpenThread<T>(
		channel: SendableChannels | ThreadChannel,
		work: () => Promise<T>
	) {
		if (!channel.isThread() || !channel.archived) return work()
		await channel.setArchived(false)
		try {
			return await work()
		} finally {
			await channel.setArchived(true)
		}
	}
	async function publish(guild: Guild, channel: SendableChannels | ThreadChannel, key: string) {
		const document = card(key)
		if (!document) return
		const values = [guild.id, channel.id, key]
		const { rows } = await pool.query<{ message_id: string; fingerprint: string }>(
			`SELECT message_id, fingerprint FROM capture_stat_messages
			WHERE guild_id = $1 AND channel_id = $2 AND card_key = $3`, values
		)
		const prior = rows[0]
		if (prior?.fingerprint === document.fingerprint) return

		await enqueueCaptureEdit(prior?.message_id ?? channel.id, async () => {
			let message = prior ? await channel.messages.fetch(prior.message_id).catch(error => {
				if (Number(getError(error).code) !== 10008) throw error
				return null
			}) : null
			await withOpenThread(channel, async () => {
				if (!message) {
					const recent = await channel.messages.fetch({ limit: 30 })
					message = recent.find(candidate =>
						candidate.author.id === guild.client.user?.id &&
						candidate.components.some(component => component.id === MARKER)
					) ?? null
				}
				if (message) await message.edit(document.payload)
				else {
					const nonce = createHash('sha256').update(values.join(':')).digest('hex').slice(0, 24)
					message = await channel.send({ ...document.payload, nonce, enforceNonce: true })
				}
				if (key !== 'rank' && !message.pinned) await message.pin()
				await pool.query(
					`INSERT INTO capture_stat_messages VALUES ($1, $2, $3, $4, $5)
					ON CONFLICT (guild_id, channel_id, card_key) DO UPDATE
					SET message_id = EXCLUDED.message_id, fingerprint = EXCLUDED.fingerprint`,
					[...values, message.id, document.fingerprint]
				)
			})
		})
	}
	async function save(guildId: string, captures: CaptureStats[], historical = false) {
		if (!captures.length) return
		await pool.query(
			`INSERT INTO capture_statistics (guild_id, war_key, result)
			SELECT $1, item->>'key', item FROM jsonb_array_elements($2::jsonb) AS item
			ON CONFLICT (guild_id, war_key) ${historical ? 'DO NOTHING' :
				'DO UPDATE SET result = EXCLUDED.result WHERE capture_statistics.result IS DISTINCT FROM EXCLUDED.result'}`,
			[guildId, JSON.stringify([...new Map(captures.map(capture => [capture.key, capture])).values()])]
		)
	}
	async function refresh(guild: Guild) {
		if (!store.ready) return
		if (!historicalLoaded) {
			const { rows } = await pool.query<{ raw: RawWar }>(
				`SELECT data->'raw' AS raw FROM family_wars
				WHERE guild_id = $1 AND war_key LIKE $2 AND data->>'status' = 'finished'
				AND NOT (data ? 'testSource')`, [guild.id, SERVER + ':%']
			)
			const rules = rulesFromEnv(env)
			const captures = rows.flatMap(({ raw }) => {
				try {
					const war = normalizeWar(raw, rules)
					const stats = war && captureStats(war)
					return stats ? [stats] : []
				} catch {
					return []
				}
			})
			await save(guild.id, captures, true)
			historicalLoaded = true
		}
		const key = env.FAMILY_WARS_API_KEY?.trim()
		if (key) {
			try {
				const wars = await fetchFinishedCaptures(key, env, fetchImpl)
				await save(guild.id, wars.map(captureStats).filter(stats => stats !== null))
			} catch (error) {
				console.error('[CaptureRankings] Majestic:', getError(error).message)
			}
		}
		const { rows } = await pool.query<{ result: CaptureStats }>(
			'SELECT result FROM capture_statistics WHERE guild_id = $1', [guild.id]
		)
		histories = captureHistories(rows.map(row => row.result))
		loaded = true
		cached = undefined

		const channelId = store.getSetting(RANK_CHANNEL)
		if (channelId && roster) {
			try {
				const channel = await guild.channels.fetch(channelId)
				if (channel?.isSendable()) await publish(guild, channel, 'rank')
			} catch (error) {
				console.error('[CaptureRankings] Рейтинг:', getError(error).message)
			}
		}
		const archiveParent = store.getSetting('PARENT_CHANNEL_ID')
		if (!histories.size || !archiveParent) return
		for (const thread of (await fetchArchiveThreads(guild, archiveParent)).values()) {
			const staticId = / (\d+)$/.exec(thread.name)?.[1]
			if (!staticId || !histories.has(staticId)) continue
			await publish(guild, thread, staticId).catch(error =>
				console.error('[CaptureRankings] Архив', thread.id, getError(error).message)
			)
		}
	}
	function run(guild: Guild) {
		return pending ??= refresh(guild).finally(() => { pending = undefined })
	}
	return {
		updateRoster,
		refresh: run,
		byDiscord,
		byStatic: () => ranking().statics,
		view: () => ({ ready: loaded && Boolean(roster), players: ranking().rows }),
		start(guild: Guild) {
			if (timer) return
			const tick = () => void run(guild).catch(error =>
				console.error('[CaptureRankings]', getError(error).message))
			tick()
			timer = setInterval(tick, INTERVAL)
			timer.unref?.()
		},
		async stop() {
			clearInterval(timer)
			timer = undefined
			await pending?.catch(() => {})
		},
		async handle(interaction: ButtonInteraction<'cached'>) {
			const match = /^capstats:(rank|\d+):(\d+)$/.exec(interaction.customId)
			if (!match || interaction.message.author.id !== interaction.client.user.id) return
			await interaction.deferUpdate()
			await enqueueCaptureEdit(interaction.message.id, async () => {
				const { rowCount } = await pool.query(
					`SELECT 1 FROM capture_stat_messages
					WHERE guild_id = $1 AND channel_id = $2 AND card_key = $3 AND message_id = $4`,
					[interaction.guildId, interaction.channelId, match[1], interaction.message.id]
				)
				const document = rowCount && card(match[1], Number(match[2]))
				const channel = interaction.channel
				if (document && channel?.isSendable())
					await withOpenThread(channel, () => interaction.editReply(document.payload))
			})
		}
	}
}
