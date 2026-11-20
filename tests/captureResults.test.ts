import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, ContainerBuilder, type Client, type Message, TextDisplayBuilder } from 'discord.js'
import type { Pool } from 'pg'
import { captureNoticeKey } from '../src/features/capture/captureNotice'
import { createCaptureResults, matchesCapture, captureResultText } from '../src/services/captureResults'
import { normalizeWar, rulesFromEnv } from '../src/features/capture/familyWarData'
import type { RawWar } from '../src/features/capture/familyWarTypes'

const notice = { attack: true, enemy: 'Enemy', startTime: '13.11.2026 18:30', zone: 'C50' }

test('identifies the same Majestic capture independently of notification formatting', () => {
	const capture = { attack: true, enemy: 'Masquerade', startTime: '20.11.2026 16:38:00', zone: 'BD58', server: 'Miami' }
	const key = captureNoticeKey(capture)
	assert.ok(key)
	assert.equal(captureNoticeKey({ ...capture, enemy: ' MASQUERADE ', startTime: '20.11.2026  16:38', zone: 'bd58' }), key)
	for (const change of [{ attack: false }, { server: 'Other' }, { enemy: 'Other' }, { zone: 'AB53' }, { startTime: '20.11.2026 16:39:00' }]) {
		assert.notEqual(captureNoticeKey({ ...capture, ...change }), key)
	}
	assert.equal(captureNoticeKey({ ...capture, startTime: 'Не указано' }), undefined)
})

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
	assert.match(text, /\*\*Участников: 2 · Киллы: 6 · Урон: 600\*\*/)
	assert.match(text, /⭐ \*\*Урон:\*\* Damage \/ 10 — \*\*500\*\*/)
	assert.match(text, /🎯 \*\*Киллы:\*\* Kills \/ 20 — \*\*5\*\*/)
	assert.match(text, /`# │ Киллы │ Урон` Игрок\n`1 │     5 │  100` Kills \/ 20\n`2 │     1 │  500` Damage \/ 10 ⭐/)
	assert.doesNotMatch(text, /Enemy MVP/)
	assert.match(captureResultText(normalizeWar({ ...raw(), winner: 2 }, rulesFromEnv())!), /Поражение/)
})

function fixture() {
	const rows: any[] = [], edits: any[] = []
	let captures = [raw()], fail = true, fetches = 0
	const missing = new Set<string>()
	const original = new ContainerBuilder().setAccentColor(0x5865f2)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent('Telegram announcement and registration @everyone'))
		.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('capt_tg_enemy_time').setLabel('Создать регу').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId('unrelated').setLabel('Другая кнопка').setStyle(ButtonStyle.Secondary)
		)).toJSON()
	const message = { author: { id: 'bot' }, components: [{ toJSON: () => original }], async edit(payload: any) {
		if (fail) throw new Error('Discord unavailable')
		edits.push(payload)
		this.components = payload.components.map((value: any) => ({ toJSON: () => value }))
	} }
	const pool = { async query(sql: string, args: any[] = []) {
		if (sql.startsWith('INSERT')) rows.push({ message_id: args[0], channel_id: args[1], guild_id: args[2], notice: JSON.parse(args[3]), api_id: null, version: null })
		if (sql.startsWith('SELECT *')) {
			return { rows: rows.map(row => ({ ...row })) }
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
	const options = { pool, client: { user: { id: 'bot' }, guilds: { async fetch() { return { members: { async fetch() { return members } } } } }, channels: { async fetch() { return { guildId: 'guild', isTextBased: () => true, messages: { async fetch(id: string) {
		if (missing.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 })
		return message
	} } } } } } as unknown as Client,
		now: () => Date.parse('2026-11-13T18:30:00+03:00'),
		env: { FAMILY_WARS_API_KEY: 'test', GUILD_ID: 'guild' }, logger: { error() {} },
		fetchImpl: (async () => { fetches++; return { ok: true, json: async () => ({ code: 200, status: true, result: { serverId: 'RU8', captures } }) } }) as unknown as typeof fetch }
	return { rows, edits, original, options, missing, setFail(value: boolean) { fail = value }, setCaptures(value: RawWar[]) { captures = value }, getFetches: () => fetches }
}

test('polls every minute during captures and every 15 minutes outside the window, including after restart', async t => {
	t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-11-13T21:14:00+03:00') })
	const { options, getFetches, rows } = fixture()
	const service = createCaptureResults({ ...options, now: Date.now })
	await service.track({ id: 'message', channelId: 'channel', guildId: 'guild' }, notice)
	const settle = () => new Promise(resolve => setImmediate(resolve))
	service.start()
	await settle()
	assert.equal(getFetches(), 1)
	t.mock.timers.tick(60000)
	await settle()
	assert.equal(getFetches(), 2)
	t.mock.timers.tick(14 * 60000)
	await settle()
	assert.equal(getFetches(), 2)
	t.mock.timers.tick(60000)
	await settle()
	assert.equal(getFetches(), 3)
	assert.equal(rows[0].api_id, null)
	await service.stop()
	t.mock.timers.setTime(Date.parse('2026-11-15T12:00:00+03:00'))
	service.start()
	await service.stop()
	assert.equal(getFetches(), 4)
})

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
	const restarted = createCaptureResults({ ...options, now: () => Date.parse('2026-11-13T23:30:00+03:00') })
	captures[0].startAt = '2026-11-13T15:50:00Z'
	await restarted.poll()
	assert.equal(edits.length, 1)
	assert.equal(rows[0].api_id, '1')
	assert.match(rows[0].version, /Победа/)
	assert.match(rows[0].version, /<@bound>/)
	const expected = structuredClone(original)
	const buttons = expected.components[1] as { components: { disabled?: boolean }[] }
	buttons.components[0].disabled = true
	assert.deepEqual(edits[0].components[0].components, expected.components)
	assert.match(rows[0].version, /`2 │     1 │  500` <@bound> ⭐/)
	assert.doesNotMatch(rows[0].version, /Damage/)
	assert.equal(edits[0].components[0].accent_color, 0x57f287)
	assert.equal(edits[0].components[1].accent_color, 0x57f287)
	assert.deepEqual(edits[0].allowedMentions, { parse: ['everyone'] })
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
	await service.track({ id: 'second', channelId: 'channel', guildId: 'guild' }, { ...notice, zone: 'different' })
	await service.poll()
	assert.ok(rows.every(row => row.api_id === null))
	rows[0].api_id = '1'
	await service.poll()
	assert.equal(rows[1].api_id, null)
	assert.equal(edits.length, 0)
})

test('assigns results once for duplicate legacy announcements, using the surviving copy if needed', async () => {
	for (const firstDeleted of [false, true]) {
		const { options, rows, edits, missing, setFail, getFetches } = fixture()
		setFail(false)
		if (firstDeleted) missing.add('first')
		const service = createCaptureResults(options)
		await service.track({ id: 'first', channelId: 'channel', guildId: 'guild' }, notice)
		await service.track({ id: 'second', channelId: 'channel', guildId: 'guild' }, { ...notice, startTime: notice.startTime + ':00' })
		await service.poll()
		assert.deepEqual(rows.map(row => row.api_id), firstDeleted ? [null, '1'] : ['1', null])
		assert.equal(edits.length, 1)
		await service.poll()
		assert.equal(getFetches(), 1)
	}
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
	assert.match(text, /`1 │     5 │  500` <@unique> ⭐/)
	assert.match(text, /`3 │     1 │  500` <@explicit> ⭐/)
	assert.doesNotMatch(text, /Tie|Damage/)
	assert.match(text, /Kills \/ 20/)
	assert.ok(text.indexOf('`1 │') < text.indexOf('`2 │'))
	assert.doesNotMatch(text, /@everyone|<@duplicate|<@excluded/)
	assert.match(captureResultText(normalizeWar({ ...raw(), status: 'pending', players: {} }, rulesFromEnv())!), /Капт не завершён[\s\S]*Состав пока не получен/)
})

test('aligns numeric columns, keeps mentions outside code and marks incomplete totals', () => {
	const value = raw()
	value.players!['1698'] = [
		{ id: 10, name: 'Player', damage: 14250, kills: 12 },
		{ id: 20, name: 'Unknown', damage: -1 }
	]
	const members = [{ id: '123', nickname: 'Player | 10', user: { bot: false } }]
	const text = captureResultText(normalizeWar(value, rulesFromEnv())!, members as any)
	assert.match(text, /Участников: 2 · Киллы: — · Урон: —/)
	assert.match(text, /`# │ Киллы │   Урон` Игрок\n`1 │    12 │ 14 250` <@123> ⭐\n`2 │     — │      —` Unknown \/ 20/)
	assert.doesNotMatch(text, /^`[^`\n]*<@/m)
})
