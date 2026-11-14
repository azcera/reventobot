import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, ContainerBuilder, type Client, type Message, TextDisplayBuilder } from 'discord.js'
import type { Pool } from 'pg'
import { createCaptureResults, matchesCapture, captureResultText } from '../src/services/captureResults'
import { normalizeWar, rulesFromEnv } from '../src/features/capture/familyWarData'
import type { RawWar } from '../src/features/capture/familyWarTypes'

const notice = { attack: true, enemy: 'Enemy', startTime: '13.11.2026 18:30', zone: 'C50' }
function raw(): RawWar {
	return { id: 1, attackersId: 1698, defendersId: 2, defendersName: 'Enemy',
		startAt: '2026-11-13T15:30:00Z', gangZoneId: 12, status: 'finished', winner: 1698,
		players: { '1698': [{ id: 10, name: 'Damage', damage: 500, kills: 1 }, { id: 20, name: 'Kills', damage: 100, kills: 5 }],
			'2': [{ id: 30, name: 'Enemy MVP', damage: 9999, kills: 99 }] } }
}

test('matches Moscow time with up to 20 minutes delay, opponent and our side; ignores zone', () => {
	const war = normalizeWar(raw(), rulesFromEnv())!
	assert.equal(matchesCapture(notice, war), true)
	assert.equal(matchesCapture({ ...notice, zone: 'other' }, war), true)
	for (const change of [{ enemy: 'Other' }, { attack: false }, { startTime: '13.11.2026 18:31' }, { startTime: 'unknown' }]) {
		assert.equal(matchesCapture({ ...notice, ...change }, war), false)
	}
	for (const minute of [31, 50]) assert.equal(matchesCapture(notice, normalizeWar({ ...raw(), startAt: `2026-11-13T15:${minute}:00Z` }, rulesFromEnv())!), true)
	for (const startAt of ['2026-11-13T15:29:00Z', '2026-11-13T15:51:00Z', '2026-11-14T15:30:00Z']) {
		assert.equal(matchesCapture(notice, normalizeWar({ ...raw(), startAt }, rulesFromEnv())!), false)
	}
	const defense = normalizeWar({ ...raw(), attackersId: 2, defendersId: 1698, attackersName: 'Enemy' }, rulesFromEnv())!
	assert.equal(matchesCapture({ ...notice, attack: false }, defense), true)
	assert.equal(matchesCapture(notice, defense), false)
	const text = captureResultText(war)
	assert.match(text, /Победа/)
	assert.match(text, /Damage \/ 10 — \*\*500 \| 1\*\* ⭐/)
	assert.match(text, /Kills \/ 20 — \*\*100 \| 5\*\*/)
	assert.ok(text.indexOf('Kills /') < text.indexOf('Damage /'))
	assert.doesNotMatch(text, /Enemy MVP/)
	assert.match(captureResultText(normalizeWar({ ...raw(), winner: 2 }, rulesFromEnv())!), /Поражение/)
})

function fixture() {
	const rows: any[] = [], edits: any[] = []
	let captures = [raw()], fail = true, fetches = 0
	const original = new ContainerBuilder().setAccentColor(0x5865f2).addTextDisplayComponents(new TextDisplayBuilder().setContent('Telegram announcement and registration')).toJSON()
	const message = { author: { id: 'bot' }, components: [{ toJSON: () => original }], async edit(payload: any) {
		if (fail) throw new Error('Discord unavailable')
		edits.push(payload)
		this.components = payload.components.map((value: any) => ({ toJSON: () => value }))
	} }
	const pool = { async query(sql: string, args: any[] = []) {
		if (sql.startsWith('INSERT')) rows.push({ message_id: args[0], channel_id: args[1], guild_id: args[2], notice: JSON.parse(args[3]), api_id: null, version: null })
		if (sql.startsWith('SELECT *')) {
			assert.match(sql, /api_id IS NULL/)
			return { rows: rows.filter(row => row.api_id === null).map(row => ({ ...row })) }
		}
		if (sql.startsWith('SELECT api_id')) return { rows: rows.filter(row => row.api_id !== null).map(row => ({ api_id: row.api_id })) }
		if (sql.startsWith('UPDATE')) {
			const row = rows.find(row => row.message_id === args[0])
			if (sql.includes('SET api_id')) {
				if (row.api_id !== null) return { rows: [] }
				row.api_id = String(args[1])
				row.version = args[2]
				return { rows: [{ api_id: row.api_id }] }
			}
			row.version = args[1]
		}
		return { rows: [] }
	} } as unknown as Pool
	const members = new Collection<string, any>([['bound', { id: 'bound', nickname: 'Damage | 10', user: { bot: false } }]])
	const options = { pool, client: { user: { id: 'bot' }, guilds: { async fetch() { return { members: { async fetch() { return members } } } } }, channels: { async fetch() { return { guildId: 'guild', isTextBased: () => true, messages: { async fetch() { return message } } } } } } as unknown as Client,
		env: { FAMILY_WARS_API_KEY: 'test', GUILD_ID: 'guild' }, logger: { error() {} },
		fetchImpl: (async () => { fetches++; return { ok: true, json: async () => ({ code: 200, status: true, result: { serverId: 'RU8', captures } }) } }) as unknown as typeof fetch }
	return { rows, edits, original, options, setFail(value: boolean) { fail = value }, setCaptures(value: RawWar[]) { captures = value }, getFetches: () => fetches }
}

test('only processes null IDs, retries failed edits after restart and stops polling completed notices', async () => {
	const { rows, edits, original, options, setFail, setCaptures, getFetches } = fixture()
	const service = createCaptureResults(options)
	await service.track({ id: 'message', channelId: 'channel', guildId: 'guild' } as Message, notice)
	assert.equal(rows[0].api_id, null)
	const captures: RawWar[] = [{ ...raw(), status: 'pending' }]
	setCaptures(captures)
	await service.poll()
	assert.equal(edits.length, 0)
	assert.equal(rows[0].api_id, null)
	captures[0].status = 'finished'
	await service.poll()
	assert.equal(rows[0].version, null)
	assert.equal(rows[0].api_id, null)
	setFail(false)
	const restarted = createCaptureResults(options)
	captures[0].startAt = '2026-11-13T15:50:00Z'
	await restarted.poll()
	assert.equal(edits.length, 1)
	assert.equal(rows[0].api_id, '1')
	assert.match(rows[0].version, /Победа/)
	assert.match(rows[0].version, /<@bound>/)
	assert.deepEqual(edits[0].components[0].components, original.components)
	assert.equal(edits[0].components[0].accent_color, 0x57f287)
	assert.equal(edits[0].components[1].accent_color, 0x57f287)
	assert.deepEqual(edits[0].allowedMentions, { parse: [] })
	await restarted.poll()
	assert.equal(edits.length, 1)
	captures[0].winner = 2
	await restarted.poll()
	assert.equal(edits.length, 1)
	assert.match(rows[0].version, /Победа/)
	const before = getFetches()
	await Promise.all([restarted.poll(), restarted.poll()])
	assert.equal(getFetches(), before)
})

test('skips ambiguous battles, competing notices and already claimed IDs', async () => {
	const { options, rows, edits, setFail, setCaptures } = fixture()
	setFail(false)
	const service = createCaptureResults(options)
	await service.track({ id: 'first', channelId: 'channel', guildId: 'guild' }, notice)
	setCaptures([raw(), { ...raw(), id: 2, startAt: '2026-11-13T15:50:00Z' }])
	await service.poll()
	assert.equal(rows[0].api_id, null)
	assert.equal(edits.length, 0)
	setCaptures([raw()])
	await service.track({ id: 'second', channelId: 'channel', guildId: 'guild' }, notice)
	await service.poll()
	assert.ok(rows.every(row => row.api_id === null))
	rows[0].api_id = '1'
	await service.poll()
	assert.equal(rows[1].api_id, null)
	assert.equal(edits.length, 0)
})

test('renders defeat in red, replaces an old result and coalesces concurrent polls', async () => {
	const { options, rows, edits, setFail, setCaptures, getFetches } = fixture()
	const service = createCaptureResults(options)
	await service.track({ id: 'message', channelId: 'channel', guildId: 'guild' }, notice)
	setCaptures([{ ...raw(), winner: 2 }])
	setFail(false)
	// An existing result from the previous implementation must not prevent assigning an ID.
	rows[0].version = captureResultText(normalizeWar({ ...raw(), winner: 2 }, rulesFromEnv())!)
	await Promise.all([service.poll(), service.poll()])
	assert.equal(getFetches(), 1)
	assert.equal(rows[0].api_id, '1')
	assert.equal(edits[0].components[0].accent_color, 0xed4245)
	assert.equal(edits[0].components[1].accent_color, 0xed4245)
	assert.match(rows[0].version, /Поражение/)
})

test('sorts equal kills by damage, stars ties and uses only unique, nonexcluded bindings', () => {
	const value = raw()
	value.players!['1698'].push({ id: 40, name: 'Tie', damage: 500, kills: 5 }, { id: 50, name: '@everyone', damage: 1, kills: 0 })
	const members = [
		{ id: 'unique', nickname: 'Player | 40', user: { bot: false } },
		{ id: 'explicit', nickname: 'Player', user: { bot: false } },
		{ id: 'duplicate1', nickname: 'Player | 20', user: { bot: false } },
		{ id: 'duplicate2', nickname: 'Player | 20', user: { bot: false } },
		{ id: 'excluded', nickname: 'Player | 50', user: { bot: false } }
	]
	const text = captureResultText(normalizeWar(value, rulesFromEnv())!, members as any, { explicit: { static: '10' }, excluded: { excluded: true } })
	assert.match(text, /Tie \/ <@unique> — \*\*500 \| 5\*\* ⭐/)
	assert.match(text, /Damage \/ <@explicit> — \*\*500 \| 1\*\* ⭐/)
	assert.match(text, /Kills \/ 20/)
	assert.ok(text.indexOf('Tie /') < text.indexOf('Kills /'))
	assert.doesNotMatch(text, /@everyone|<@duplicate|<@excluded/)
	assert.match(captureResultText(normalizeWar({ ...raw(), status: 'pending', players: {} }, rulesFromEnv())!), /Капт не завершён[\s\S]*Состав пока не получен/)
})
