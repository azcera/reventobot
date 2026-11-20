import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelType, Collection, type ButtonInteraction, type Guild, type Message } from 'discord.js'
import type { Pool } from 'pg'
import { createStore } from '../src/dashboard/store'
import { captureHistories, captureStats, rankCapturePlayers, type CaptureStats } from '../src/features/capture/captureRanking'
import { compareCaptureRanks, nextCaptureSort } from '../src/features/capture/captureSort'
import { normalizeWar, queueRows, rulesFromEnv } from '../src/features/capture/familyWarData'
import type { RawWar, WarPlayer } from '../src/features/capture/familyWarTypes'
import { createCaptureRankings } from '../src/services/captureRankings'
import { fetchMitsukiCaptureRanking } from '../src/services/mitsukiCaptureRanking'
import type { MembershipSnapshot, Store } from '../src/types'

const player = (id: number, kills?: number, damage?: number, deaths?: number): WarPlayer =>
	({ id, name: `Player ${id}`, kills, damage, deaths })
const battle = (id: number, players: WarPlayer[]): RawWar => ({
	id, attackersId: 1698, defendersId: 10, defendersName: 'Rivals',
	startAt: `2026-10-${String(id).padStart(2, '0')}T14:00:00Z`,
	winnerId: 1698, status: 'finished',
	players: { '1698': players, '10': [player(99, 200, 10000)] }
})
const normalize = (war: RawWar) => normalizeWar(war, rulesFromEnv({}))!

test('counts both MVP categories independently, including ties and partially reported stats', () => {
	const war = normalize(battle(1, [
		player(1, 5, 700), player(2, 5, 200), player(3, 2, 700), player(4, 1)
	]))
	const stats = captureStats(war)!
	assert.equal(stats.result, 'Победа')
	assert.deepEqual(stats.players.map(p => [p.staticId, p.mvp, p.damage]), [
		['1', 2, 700], ['2', 1, 200], ['3', 1, 700], ['4', 0, null]
	])
	assert.equal(captureStats({ ...war, status: 'active' }), null)
	assert.equal(captureStats({ ...war, neutral: true }), null)
	assert.equal(captureStats({ ...war, testSource: { apiId: 20, startAt: 10 } }), null)
})

test('the leaderboard is keyed by STATIC, configurable and limited to the current roster', () => {
	const first = captureStats(normalize(battle(1, [
		player(1, 10, 100), player(2, 1, 1000), player(3, 2, 200)
	])))!
	const second = captureStats(normalize(battle(2, [player(2, 1), player(3, 2, 600)])))!
	const histories = captureHistories([first, second])
	const members = new Set(['1', '2'])
	const killed = rankCapturePlayers(histories, members, 100)
	const damage = rankCapturePlayers(histories, members, 10)
	assert.deepEqual(killed.map(p => [p.staticId, p.position]), [['1', 1], ['2', 2]])
	assert.equal(damage[0].staticId, '2')
	assert.equal(damage[0].damage, 1000)
	assert.equal(damage[0].captures, 2)
	assert.equal(damage[0].averageKills, 1)
	assert.equal(histories.get('3')?.length, 2)
	assert.ok(!Object.hasOwn(damage[0], 'score'))
	const equalPerformance = { ...first, players: [
		{ staticId: '1', name: 'First', kills: 5, damage: 500, mvp: 1 },
		{ staticId: '2', name: 'Second', kills: 5, damage: 500, mvp: 2 }
	] }
	assert.equal(rankCapturePlayers(captureHistories([equalPerformance]), members, 70)[0].staticId, '2')
})

test('experience rewards consistent performance, but exceptional form can still outrank it', () => {
	const games = Array.from({ length: 14 }, (_, index) => captureStats(normalize(battle(index + 1, [
		player(1, 3, 500, 2),
		...(index === 13 ? [player(2, 3, 500, 2)] : []),
		...(index > 7 ? [player(3, 12, 2400, 1)] : []),
		player(4, 5, 3000)
	])))!)
	const rows = rankCapturePlayers(captureHistories(games), new Set(['1', '2', '3', '4']), 70)
	const row = (id: string) => rows.find(entry => entry.staticId === id)!
	assert.ok(row('1').position < row('2').position)
	assert.ok(row('3').position < row('1').position)
	assert.equal(row('1').averageKills, 3)
	assert.equal(row('4').averageKills, 5)
})

test('average kills counts reported zeroes and skips unreported kills', () => {
	const games = [
		battle(1, [player(1, 4, 200)]),
		battle(2, [player(1, 0, 100)]),
		battle(3, [player(1, undefined, 100), player(2, undefined, 50)])
	].map(raw => captureStats(normalize(raw))!)
	const histories = captureHistories(games)
	const roster = new Set(['1', '2'])
	const rows = rankCapturePlayers(histories, roster, 70)
	assert.equal(rows.find(row => row.staticId === '1')?.averageKills, 2)
	assert.equal(rows.find(row => row.staticId === '2')?.averageKills, null)
})

const mitsukiPlayer = (id: number, rating: number | null) => ({
	key: `s:${id}`, static: id, nickname: `Mitsuki Player ${id}`,
	captures: 12, avgDamage: 900, avgKills: 3, winrate: 70, rating
})

test('Mitsuki positions use the API rating first and the site’s K/D for players without rating', async () => {
	const rows = await fetchMitsukiCaptureRanking(async input => {
		assert.equal(new URL(String(input)).searchParams.get('period'), 'month')
		return Response.json({ players: [mitsukiPlayer(6, null), mitsukiPlayer(7, 800),
			mitsukiPlayer(8, 900), mitsukiPlayer(9, 900),
			{ ...mitsukiPlayer(10, null), avgKills: 1.3 },
			{ ...mitsukiPlayer(11, null), avgKills: 5 }] })
	})
	assert.deepEqual(rows.map(row => [row.staticId, row.position, row.rating]), [
		['8', 1, 900], ['9', 2, 900], ['7', 3, 800],
		['11', 4, null], ['6', 5, null], ['10', 6, null]
	])
})

test('registration cycles through rating, role priority and time; unranked entries use the old fallback', () => {
	assert.deepEqual(['rating', 'priority', 'time'].map(nextCaptureSort), ['priority', 'time', 'rating'])
	assert.equal(compareCaptureRanks(undefined, undefined), 0)
	const war = normalize(battle(1, [player(1), player(2), player(3)]))
	const ranks = new Map([['2', 4]])
	const registration = { sortMode: 'rating', seen: { '1': 1, '2': 3, '3': 2 } }
	const rows = queueRows(war, registration, new Map(), {}, [], 10, ranks)
	assert.deepEqual(rows.map(row => row.static), ['2', '1', '3'])
})

test('imports available history once per battle, pins archive cards and picks up later Discord bindings', async () => {
	const stored = new Map<string, CaptureStats>()
	let inclusion = new Map<string, boolean>()
	const audits: unknown[] = []
	const messages = new Map<string, { message_id: string; fingerprint: string }>()
	let sent = 0
	const historic = battle(1, [player(1, 2, 200), player(2, 10, 50)])
	const recent = battle(2, [player(1, 5, 600)])
	const pool = {
		async query(sql: string, values: string[]) {
			if (sql.includes('FROM family_wars')) return { rows: [{ raw: historic }] }
			if (sql.includes('INSERT INTO capture_statistics')) {
				for (const capture of JSON.parse(values[1]) as CaptureStats[])
					if (!sql.includes('DO NOTHING') || !stored.has(capture.key))
						stored.set(capture.key, capture)
			}
			if (sql.includes('SELECT result')) return {
				rows: [...stored.values()].map(result => ({ result, included: inclusion.get(result.key) ?? true }))
			}
			if (sql.startsWith('SELECT card_key, message_id')) return {
				rows: ['rank', 'mitsuki'].flatMap(card_key => {
					const message = messages.get(values[1] + ':' + card_key)
					return message ? [{ card_key, ...message }] : []
				})
			}
			if (sql.includes('SET message_id = CASE')) {
				messages.set(values[1] + ':mitsuki', { message_id: values[2], fingerprint: '' })
				messages.set(values[1] + ':rank', { message_id: values[3], fingerprint: '' })
			}
			if (sql.includes('FROM capture_stat_messages')) {
				const message = messages.get(values[1] + ':' + values[2])
				if (sql.startsWith('SELECT 1')) return { rowCount: message?.message_id === values[3] ? 1 : 0 }
				return { rows: message ? [message] : [] }
			}
			if (sql.includes('INSERT INTO capture_stat_messages'))
				messages.set(values[1] + ':' + values[2], { message_id: values[3], fingerprint: values[4] })
			return { rows: [] }
		},
		async connect() {
			const draft = new Map(inclusion)
			return {
				async query(sql: string, values: string[]) {
					if (sql === 'COMMIT') inclusion = draft
					if (!sql.includes('UPDATE capture_statistics')) return { rows: [] }
					const changes = JSON.parse(values[1]) as { key: string; included: boolean }[]
					const existing = changes.filter(change => stored.has(change.key))
					for (const change of existing) draft.set(change.key, change.included)
					return { rowCount: existing.length }
				},
				release() {}
			}
		}
	} as unknown as Pool
	const config = createStore()
	const store = {
		ready: true,
		text: config.text,
		async audit(_actor: unknown, action: string, _target: string, details: unknown) {
			audits.push({ action, details })
		},
		getSetting: (key: string) => ({
			PARENT_CHANNEL_ID: 'archives', CAPTURE_RANK_CHANNEL_ID: 'ranking',
			CAPTURE_RANK_KILL_WEIGHT: '70'
		})[key]
	} as Store
	const channel = (id: string, name: string, thread: boolean) => {
		const deliveries: string[] = []
		let pins = 0
		const saved = new Collection<string, Message>()
		return {
			id, name, archived: thread, deliveries, pins: () => pins,
			isSendable: () => true, isThread: () => thread,
			async setArchived(value: boolean) { this.archived = value },
			messages: { fetch: async (arg: string | { message?: string }) => {
				const id = typeof arg === 'string' ? arg : arg.message
				return id ? saved.get(id) : saved
			} },
			async send(payload: object) {
				const components = (json: string) => (JSON.parse(json).components as { id: number }[])
					.map(component => ({ id: component.id, toJSON: () => structuredClone(component) }))
				const rendered = JSON.stringify(payload)
				deliveries.push(rendered)
				const message = {
					id: String(++sent),
					pinned: false, author: { id: 'bot' }, components: components(rendered),
					async edit(next: object) {
						const json = JSON.stringify(next)
						deliveries.push(json)
						this.components = components(json)
						return this
					},
					async pin() { pins++; this.pinned = true; return this }
				}
				saved.set(message.id, message as unknown as Message)
				return message
			}
		}
	}
	const ranking = channel('ranking', 'ranking', false)
	const archive = channel('archive-one', 'archive first 1', true)
	const empty = channel('archive-empty', 'archive empty 3', true)
	const idle = channel('archive-departed', 'archive second 2', true)
	const parent = {
		type: ChannelType.GuildText,
		threads: {
			fetchActive: async () => ({ threads: new Collection() }),
			fetchArchived: async () => ({
				threads: new Collection([[archive.id, archive], [empty.id, empty], [idle.id, idle]]),
				hasMore: false
			})
		}
	}
	const discordId = '123456789012345678'
	const mitsukiDiscordId = '876543210987654321'
	let majesticAvailable = true
	const snapshot = (statics: string[], linked: [string, string][] = []) => ({
		statics: new Set(statics), linked: new Map(linked)
	}) as MembershipSnapshot
	const guild = {
		id: 'guild', client: {
			user: { id: 'bot' },
			majesticSync: {
				state: async () => ({ configured: majesticAvailable, decisions: {} }),
				membershipSnapshot: async () => snapshot(['1'])
			}
		},
		channels: { fetch: async (id: string) => id === 'archives' ? parent : ranking },
		members: { cache: new Collection([
			[discordId, { id: discordId, user: { bot: false }, nickname: null }],
			[mitsukiDiscordId, { id: mitsukiDiscordId, user: { bot: false }, nickname: 'Mitsuki | 75' }]
		]) }
	} as unknown as Guild
	const makeService = () => createCaptureRankings({
		pool, store, env: { FAMILY_WARS_API_KEY: 'fake' },
		fetchMitsuki: () => fetchMitsukiCaptureRanking(async () => Response.json({
			players: [mitsukiPlayer(75, 700), mitsukiPlayer(81, null)]
		})),
		fetchImpl: async () => Response.json({
			code: 200, status: true, result: { serverId: 'RU8', captures: [recent] }
		})
	})
	const service = makeService()
	await service.refresh(guild)
	await service.refresh(guild)
	assert.equal(stored.size, 2)
	assert.deepEqual(service.view().players.map(p => [p.staticId, p.captures]), [['1', 2]])
	assert.equal(service.byDiscord(guild).size, 0)
	assert.equal(archive.deliveries.length, 1)
	assert.equal(archive.pins(), 1)
	assert.equal(archive.archived, true)
	assert.equal(empty.deliveries.length, 0)
	assert.equal(idle.pins(), 1)
	assert.match(archive.deliveries[0], /Rivals/)
	assert.match(ranking.deliveries[0], /Рейтинг Mitsuki/)
	assert.match(ranking.deliveries[0], new RegExp(`<@${mitsukiDiscordId}>`))
	assert.doesNotMatch(ranking.deliveries[0], /Mitsuki Player 75/)
	assert.match(ranking.deliveries[1], /Player 1 \(1\)/)
	assert.doesNotMatch(ranking.deliveries[1], /STATIC|Player 2/)
	const mitsukiMessage = messages.get('ranking:mitsuki')!
	const internalMessage = messages.get('ranking:rank')!
	assert.ok(Number(mitsukiMessage.message_id) < Number(internalMessage.message_id))
	assert.equal(ranking.pins(), 0)
	assert.doesNotMatch(archive.deliveries[0], /Рейтинг Mitsuki/)

	messages.set('ranking:mitsuki', internalMessage)
	messages.set('ranking:rank', mitsukiMessage)
	const sentBeforeRepair = sent
	await service.refresh(guild)
	assert.equal(messages.get('ranking:mitsuki')?.message_id, mitsukiMessage.message_id)
	assert.equal(messages.get('ranking:rank')?.message_id, internalMessage.message_id)
	assert.equal(sent, sentBeforeRepair)
	assert.match(ranking.deliveries.at(-2)!, /Рейтинг Mitsuki/)
	assert.match(ranking.deliveries.at(-1)!, /Рейтинг каптов/)
	service.updateRoster(snapshot(['1'], [[discordId, '1']]))
	assert.equal(service.byDiscord(guild).get(discordId), 1)
	await service.refresh(guild)
	const linkedCard = ranking.deliveries.at(-1)!
	assert.match(linkedCard, new RegExp(`<@${discordId}>`))
	assert.doesNotMatch(linkedCard, /Player 1 \(1\)/)
	assert.deepEqual(JSON.parse(linkedCard).allowedMentions, { parse: [] })
	service.updateRoster(snapshot(['2']))
	await service.refresh(guild)
	assert.deepEqual(service.view().players.map(p => p.staticId), ['2'])
	assert.equal(stored.size, 2)
	assert.equal(archive.pins(), 1)
	assert.match(ranking.deliveries.at(-1)!, /Player 2 \(2\)/)

	service.updateRoster(snapshot(['1']))
	await service.saveInclusion(guild, [{ key: 'RU8:2', included: false }])
	await service.stop()
	assert.deepEqual(service.view().players.map(({ captures, averageKills, damage, mvp }) =>
		[captures, averageKills, damage, mvp]), [[1, 2, 200, 1]])
	assert.equal(service.mitsuki().players[0].rating, 700)
	assert.match(archive.deliveries.at(-1)!, /600 урона.*Вне рейтинга/)
	assert.equal(service.captures().captures[0].included, false)
	assert.deepEqual(audits, [{
		action: 'capture-ranking.captures',
		details: { changes: [{ key: 'RU8:2', included: false }] }
	}])
	await assert.rejects(service.saveInclusion(guild, [
		{ key: 'RU8:2', included: true }, { key: 'RU8:999', included: false }
	]), /не найден/)
	await service.refresh(guild)
	assert.equal(service.captures().captures[0].included, false)
	assert.equal(service.view().players[0].captures, 1)
	await service.saveInclusion(guild, [{ key: 'RU8:2', included: true }])
	assert.equal(service.view().players[0].captures, 2)
	await service.stop()

	const extraPlayers = Array.from({ length: 46 }, (_, index) => player(index + 3, 2, 100))
	recent.players!['1698'].push(...extraPlayers)
	service.updateRoster(snapshot(['1', '2', ...extraPlayers.map(entry => String(entry.id))]))
	await service.refresh(guild)
	const text = (card: string) => JSON.parse(card).components[0].components[0].content as string
	const entries = (content: string) => content.match(/^\`\s*\d+\s+│/gm) ?? []
	const firstPage = text(ranking.deliveries.at(-1)!)
	assert.match(firstPage, /Страница 1\/2/)
	assert.match(firstPage, /Ср\. киллы/)
	assert.equal(entries(firstPage).length, 40)
	const pageInteraction = {
		guild, guildId: guild.id, channel: ranking, channelId: ranking.id,
		customId: 'capstats:rank:1',
		message: { id: internalMessage.message_id, author: { id: 'bot' } },
		client: guild.client,
		deferUpdate: async () => {},
		editReply: async (payload: object) => ranking.deliveries.push(JSON.stringify(payload))
	} as unknown as ButtonInteraction<'cached'>
	await service.handle(pageInteraction)
	const secondPage = text(ranking.deliveries.at(-1)!)
	assert.match(secondPage, /Страница 2\/2/)
	assert.equal(entries(secondPage).length, 8)
	assert.match(secondPage, /^\`48\s+│/m)

	for (const entry of extraPlayers) entry.name = '*'.repeat(100)
	await service.refresh(guild)
	const longNamesPage = text(ranking.deliveries.at(-1)!)
	assert.match(longNamesPage, /Страница 1\/2/)
	assert.equal(entries(longNamesPage).length, 40)
	assert.ok(longNamesPage.length <= 4000)

	const older = await ranking.messages.fetch(mitsukiMessage.message_id) as Message
	const newer = await ranking.messages.fetch(internalMessage.message_id) as Message
	const originalMitsuki = older.components.map(component => component.toJSON())
	await older.edit({ components: [{
		id: 1698002, type: 17, components: [{
			type: 10,
			content: '## Рейтинг каптов\nИгроков: 48 · Страница 1/2\n\n' +
				'\`# │ Капты │ Ср. урон │ K/D │ MVP\` **Игрок**\n' +
				`\`1 │ 6 │ 374,83 │ — │ 2\` <@${discordId}>`
		}]
	}] })
	await newer.edit({ components: originalMitsuki })
	// A previous refresh already recorded the desired slots, but Discord still had the old pair.
	messages.set('ranking:mitsuki', { message_id: older.id, fingerprint: '' })
	messages.set('ranking:rank', { message_id: newer.id, fingerprint: '' })
	Object.assign(guild.members.cache.get(discordId)!, { nickname: 'Player | 1' })
	majesticAvailable = false
	const restarted = makeService()
	const sentBeforeRestart = sent
	await restarted.refresh(guild)
	assert.equal(restarted.view().ready, false)
	assert.equal(sent, sentBeforeRestart)
	assert.match(JSON.stringify(older.components), /Рейтинг Mitsuki/)
	assert.match(JSON.stringify(newer.components), /Капты.*│.*Ср\. урон.*│.*Ср\. киллы/)
	assert.match(JSON.stringify(newer.components), new RegExp(`374,83.*│\\s*3,5.*<@${discordId}>`))
	assert.match(JSON.stringify(newer.components), /Страница 1\/2/)
})
