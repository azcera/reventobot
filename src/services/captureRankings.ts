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
import type { Actor, MembershipSnapshot, Store } from '../types'
import { getError } from '../utils/errors'
import { fetchFinishedCaptures } from './finishedCaptures'
import { ContainerBuilder } from './markdownContainer'
import { fetchMitsukiCaptureRanking } from './mitsukiCaptureRanking'

const INTERVAL = 5 * 60000
const HISTORY_PAGE_SIZE = 15
const RANK_PAGE_SIZE = 40
const TEXT_LIMIT = 4000
const MARKER = 1698002
const MITSUKI_MARKER = 1698003
const PREFIX = 'capstats:'
const CAPTURE_KILL_WEIGHT = 'CAPTURE_RANK_KILL_WEIGHT'
const RANK_CHANNEL = 'CAPTURE_RANK_CHANNEL_ID'

interface RankedCapture extends CaptureStats {
	included: boolean
}

export function createCaptureRankings({
	pool, store, env = process.env, fetchImpl = fetch, fetchMitsuki = fetchMitsukiCaptureRanking
}: {
	pool: Pool
	store: Store
	env?: import('../types').Env
	fetchImpl?: typeof fetch
	fetchMitsuki?: typeof fetchMitsukiCaptureRanking
}) {
	let roster: MembershipSnapshot | undefined
	let loaded = false
	let captures: RankedCapture[] = []
	let mitsuki: Awaited<ReturnType<typeof fetchMitsukiCaptureRanking>> | undefined
	let histories = captureHistories([])
	let excluded = new Set<string>()
	let statisticsRead = Promise.resolve()
	let publication = Promise.resolve()
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
			const rows = rankCapturePlayers(histories, roster?.statics ?? new Set(), weight, excluded)
			cached = { weight, rows, statics: new Map(rows.map(row => [row.staticId, row.position])) }
		}
		return cached
	}
	function updateRoster(snapshot: MembershipSnapshot) {
		roster = snapshot
		cached = undefined
	}
	function discordBindings(guild: Guild) {
		const byStatic = new Map<string, string | null>()
		for (const [id, staticId] of roster?.linked ?? []) {
			byStatic.set(staticId, byStatic.has(staticId) ? null : id)
		}
		const bindings = new Map<string, string>()
		for (const [staticId, id] of byStatic) {
			if (id && guild.members.cache.has(id)) bindings.set(staticId, id)
		}
		return bindings
	}
	function byDiscord(guild?: Guild) {
		const positions = new Map<string, number>()
		if (!guild) return positions
		for (const [staticId, id] of discordBindings(guild)) {
			const position = ranking().statics.get(staticId)
			if (position) positions.set(id, position)
		}
		return positions
	}
	function card(guild: Guild, key: string, requested = 0) {
		const history = histories.get(key)
		const external = key === 'mitsuki'
		if (external ? !mitsuki : key !== 'rank' && !history?.length) return
		const { rows, statics } = ranking()
		const bindings = history ? undefined : discordBindings(guild)
		const included = history?.filter(game => !excluded.has(game.key)) ?? []
		const label = (name: string, staticId: string | null) => {
			const discordId = staticId ? bindings?.get(staticId) : undefined
			return discordId ? `<@${discordId}>` : `${clean(name)}${staticId ? ` (${staticId})` : ''}`
		}
		const lines = history
			? history.map(game =>
				`<t:${Math.floor(game.at / 1000)}:d> · ${clean(game.enemy)} · ${game.attack ? 'Атака' : 'Защита'} · ${game.result} · ${game.damage ?? '—'} урона · ${game.kills ?? '—'} килл.${excluded.has(game.key) ? ' · Вне рейтинга' : ''}`)
			: external
				? mitsuki!.map(player => {
					const stats = [player.captures, average(player.avgDamage), average(player.avgKills),
						`${player.winrate}%`, player.rating ?? '—']
					return `**${player.position}.** ${label(player.name, player.staticId)} — \`${stats.join(' · ')}\``
				})
			: rows.map(player => {
				const stats = [player.captures, average(player.damage),
					player.kd === null ? '—' : average(player.kd), player.mvp]
				return `**${player.position}.** ${label(player.name, player.staticId)} — \`${stats.join(' · ')}\``
			})
		const render = (list: string, page: number, pages: number) => history
			? store.text('captureHistory.document', {
				player: clean(history[0].name), static: key, captures: included.length,
				mvp: included.reduce((total, game) => total + game.mvp, 0),
				position: statics.get(key) ?? '—', history: list, page, pages
			})
			: external
				? `## Рейтинг Mitsuki\nЗа месяц · Игроков: ${lines.length} · Страница ${page}/${pages}\nБез оценки Mitsuki — по киллам за капт (K/D Mitsuki).\n\n**Игрок — капты · ср. урон · K/D Mitsuki · победы % · рейтинг Mitsuki**\n${list || 'Пока нет игроков с результатами.'}`
				: store.text('captureRanking.document', {
				ranking: list || 'Пока нет игроков с результатами.',
				players: rows.length, page, pages
			})
		const lists: string[] = []
		for (let start = 0; start < lines.length;) {
			let end = Math.min(lines.length, start + (history ? HISTORY_PAGE_SIZE : RANK_PAGE_SIZE))
			let list = lines.slice(start, end).join('\n')
			// The row count bounds the number of digits in both page variables.
			while (!history && end > start + 1 && render(list, lines.length, lines.length).length > TEXT_LIMIT) {
				list = lines.slice(start, --end).join('\n')
			}
			lists.push(list)
			start = end
		}
		const pages = Math.max(1, lists.length)
		const page = Math.max(0, Math.min(requested, pages - 1))
		const content = render(lists[page] ?? '', page + 1, pages)
		const marker = external ? MITSUKI_MARKER : MARKER
		const container = new ContainerBuilder().setId(marker)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
		if (pages > 1)
			container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`${PREFIX}${key}:${page - 1}`)
					.setLabel('Назад').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
				new ButtonBuilder().setCustomId(`${PREFIX}${key}:${page + 1}`)
					.setLabel('Далее').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)
			))
		return {
			marker,
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
		const document = card(guild, key)
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
						candidate.components.some(component => component.id === document.marker)
					) ?? null
				}
				if (message) await message.edit(document.payload)
				else {
					const nonce = createHash('sha256').update(values.join(':')).digest('hex').slice(0, 24)
					message = await channel.send({ ...document.payload, nonce, enforceNonce: true })
				}
				if (histories.has(key) && !message.pinned) await message.pin()
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
		if (historical) {
			const withDeaths = captures.filter(capture => capture.players.some(player => player.deaths != null))
			if (withDeaths.length) await pool.query(
				`UPDATE capture_statistics AS saved SET result = jsonb_set(saved.result, '{players}', (
					SELECT jsonb_agg(
						CASE WHEN jsonb_typeof(player->'deaths') IS DISTINCT FROM 'number' AND deaths IS NOT NULL
							THEN player || jsonb_build_object('deaths', deaths) ELSE player END
						ORDER BY position
					)
					FROM jsonb_array_elements(saved.result->'players') WITH ORDINALITY AS old(player, position)
					LEFT JOIN jsonb_to_recordset(raw->'players') AS fresh("staticId" TEXT, deaths BIGINT)
						ON fresh."staticId" = player->>'staticId'
				))
				FROM jsonb_array_elements($2::jsonb) AS source(raw)
				WHERE saved.guild_id = $1 AND saved.war_key = raw->>'key'`,
				[guildId, JSON.stringify(withDeaths)]
			)
		}
	}
	function loadStatistics(guildId: string) {
		// Serialize snapshot reads so a background refresh cannot restore stale flags.
		statisticsRead = statisticsRead.catch(() => {}).then(async () => {
			const { rows } = await pool.query<{ result: CaptureStats; included: boolean }>(
				'SELECT result, included FROM capture_statistics WHERE guild_id = $1', [guildId]
			)
			captures = rows.map(({ result, included }) => ({ ...result, included }))
				.sort((a, b) => b.at - a.at || b.key.localeCompare(a.key))
			histories = captureHistories(captures)
			excluded = new Set(captures.filter(capture => !capture.included).map(capture => capture.key))
			loaded = true
			cached = undefined
		})
		return statisticsRead
	}
	async function saveInclusion(
		guild: Guild,
		changes: { key: string; included: boolean }[],
		actor?: Actor
	) {
		const db = await pool.connect()
		try {
			await db.query('BEGIN')
			const { rowCount } = await db.query(
				`UPDATE capture_statistics AS capture SET included = change.included
				FROM jsonb_to_recordset($2::jsonb) AS change(key TEXT, included BOOLEAN)
				WHERE capture.guild_id = $1 AND capture.war_key = change.key`,
				[guild.id, JSON.stringify(changes)]
			)
			if (rowCount !== changes.length)
				throw Object.assign(new Error('Один из каптов не найден. Откройте список заново.'), { status: 409 })
			await store.audit(actor, 'capture-ranking.captures', guild.id, { changes }, db)
			await db.query('COMMIT')
		} catch (error) {
			await db.query('ROLLBACK').catch(() => {})
			throw error
		} finally {
			db.release()
		}
		await loadStatistics(guild.id)
		void queuePublication(guild).catch(error =>
			console.error('[CaptureRankings]', getError(error).message))
		return { ready: loaded, captures }
	}
	async function refresh(guild: Guild) {
		if (!store.ready) return
		const external = fetchMitsuki().then(rows => { mitsuki = rows }).catch(error =>
			console.error('[CaptureRankings] Mitsuki:', getError(error).message))
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
		await loadStatistics(guild.id)
		await external
		await queuePublication(guild)
	}

	function queuePublication(guild: Guild) {
		publication = publication.catch(() => {}).then(() => publishStatistics(guild))
		return publication
	}
	async function publishStatistics(guild: Guild) {
		const channelId = store.getSetting(RANK_CHANNEL)
		if (channelId && (roster || mitsuki)) {
			try {
				const channel = await guild.channels.fetch(channelId)
				if (channel?.isSendable()) {
					if (roster) await publish(guild, channel, 'rank').catch(error =>
						console.error('[CaptureRankings] Рейтинг:', getError(error).message))
					if (mitsuki) await publish(guild, channel, 'mitsuki').catch(error =>
						console.error('[CaptureRankings] Mitsuki:', getError(error).message))
				}
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
		captures: () => ({ ready: loaded, captures }),
		mitsuki: () => ({ ready: mitsuki !== undefined, players: mitsuki ?? [] }),
		saveInclusion,
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
			await publication.catch(() => {})
		},
		async handle(interaction: ButtonInteraction<'cached'>) {
			const match = /^capstats:(rank|mitsuki|\d+):(\d+)$/.exec(interaction.customId)
			if (!match || interaction.message.author.id !== interaction.client.user.id) return
			await interaction.deferUpdate()
			await enqueueCaptureEdit(interaction.message.id, async () => {
				const { rowCount } = await pool.query(
					`SELECT 1 FROM capture_stat_messages
					WHERE guild_id = $1 AND channel_id = $2 AND card_key = $3 AND message_id = $4`,
					[interaction.guildId, interaction.channelId, match[1], interaction.message.id]
				)
				const document = rowCount && card(interaction.guild, match[1], Number(match[2]))
				const channel = interaction.channel
				if (document && channel?.isSendable())
					await withOpenThread(channel, () => interaction.editReply(document.payload))
			})
		}
	}
}
