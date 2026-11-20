import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelType, Collection, type Guild, type Message } from 'discord.js'
import type { Pool } from 'pg'
import { createStore } from '../src/dashboard/store'
import { captureHistories, captureStats, rankCapturePlayers, type CaptureStats } from '../src/features/capture/captureRanking'
import { compareCaptureRanks, nextCaptureSort } from '../src/features/capture/captureSort'
import { normalizeWar, queueRows, rulesFromEnv } from '../src/features/capture/familyWarData'
import type { RawWar, WarPlayer } from '../src/features/capture/familyWarTypes'
import { createCaptureRankings } from '../src/services/captureRankings'
import type { MembershipSnapshot, Store } from '../src/types'

const player = (id: number, kills?: number, damage?: number): WarPlayer =>
	({ id, name: `Player ${id}`, kills, damage })
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
	const killed = rankCapturePlayers(histories, members, 70)
	const damage = rankCapturePlayers(histories, members, 10)
	assert.deepEqual(killed.map(p => [p.staticId, p.position]), [['1', 1], ['2', 2]])
	assert.equal(damage[0].staticId, '2')
	assert.equal(damage[0].damage, 1000)
	assert.equal(damage[0].captures, 2)
	assert.equal(histories.get('3')?.length, 2)
	assert.ok(!Object.hasOwn(damage[0], 'score'))
	const equalPerformance = { ...first, players: [
		{ staticId: '1', name: 'First', kills: 5, damage: 500, mvp: 1 },
		{ staticId: '2', name: 'Second', kills: 5, damage: 500, mvp: 2 }
	] }
	assert.equal(rankCapturePlayers(captureHistories([equalPerformance]), members, 70)[0].staticId, '2')
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
	const messages = new Map<string, { message_id: string; fingerprint: string }>()
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
			if (sql.includes('SELECT result')) return { rows: [...stored.values()].map(result => ({ result })) }
			if (sql.includes('FROM capture_stat_messages')) {
				const message = messages.get(values[1])
				return { rows: message ? [message] : [] }
			}
			if (sql.includes('INSERT INTO capture_stat_messages'))
				messages.set(values[1], { message_id: values[3], fingerprint: values[4] })
			return { rows: [] }
		}
	} as unknown as Pool
	const config = createStore()
	const store = {
		ready: true,
		text: config.text,
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
			messages: { fetch: async (arg: string | object) => typeof arg === 'string' ? saved.get(arg) : saved },
			async send(payload: object) {
				const rendered = JSON.stringify(payload)
				deliveries.push(rendered)
				const message = {
					id: id + '-message', pinned: false, author: { id: 'bot' }, components: [{ id: 1698002 }],
					async edit(next: object) { deliveries.push(JSON.stringify(next)); return this },
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
	const guild = {
		id: 'guild', client: { user: { id: 'bot' } },
		channels: { fetch: async (id: string) => id === 'archives' ? parent : ranking },
		members: { cache: new Collection([['discord-1', {}]]) }
	} as unknown as Guild
	const service = createCaptureRankings({
		pool, store, env: { FAMILY_WARS_API_KEY: 'fake' },
		fetchImpl: async () => Response.json({
			code: 200, status: true, result: { serverId: 'RU8', captures: [recent] }
		})
	})
	const snapshot = (statics: string[], linked: [string, string][] = []) => ({
		statics: new Set(statics), linked: new Map(linked)
	}) as MembershipSnapshot

	service.updateRoster(snapshot(['1']))
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
	assert.doesNotMatch(ranking.deliveries[0], /Player 2/)
	service.updateRoster(snapshot(['1'], [['discord-1', '1']]))
	assert.equal(service.byDiscord(guild).get('discord-1'), 1)
	service.updateRoster(snapshot(['2']))
	await service.refresh(guild)
	assert.deepEqual(service.view().players.map(p => p.staticId), ['2'])
	assert.equal(stored.size, 2)
	assert.equal(archive.pins(), 1)
	assert.match(ranking.deliveries.at(-1)!, /Player 2/)
})
