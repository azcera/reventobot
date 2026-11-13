import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type Client, type Message, TextDisplayBuilder } from 'discord.js'
import type { Pool } from 'pg'
import { createCaptureResults, matchesCapture, captureResultText } from '../src/services/captureResults'
import { normalizeWar, rulesFromEnv } from '../src/features/capture/familyWarData'
import type { RawWar } from '../src/features/capture/familyWarTypes'

const notice = { attack: true, enemy: 'Enemy', startTime: '13.11.2026 18:30', zone: '12' }
function raw(): RawWar {
	return { id: 1, attackersId: 1698, defendersId: 2, defendersName: 'Enemy',
		startAt: '2026-11-13T15:30:00Z', gangZoneId: 12, status: 'finished', winner: 1698,
		players: { '1698': [{ id: 10, name: 'Damage', damage: 500, kills: 1 }, { id: 20, name: 'Kills', damage: 100, kills: 5 }],
			'2': [{ id: 30, name: 'Enemy MVP', damage: 9999, kills: 99 }] } }
}

test('matches Telegram Moscow time, opponent, side and zone; selects our MVPs', () => {
	const war = normalizeWar(raw(), rulesFromEnv())!
	assert.equal(matchesCapture(notice, war), true)
	for (const change of [{ enemy: 'Other' }, { attack: false }, { zone: '13' }, { startTime: '13.11.2026 18:31' }, { startTime: 'unknown' }]) {
		assert.equal(matchesCapture({ ...notice, ...change }, war), false)
	}
	const text = captureResultText(war)
	assert.match(text, /Победа/)
	assert.match(text, /Damage \/ 10 — \*\*500\*\*/)
	assert.match(text, /Kills \/ 20 — \*\*5\*\*/)
	assert.doesNotMatch(text, /Enemy MVP/)
	assert.match(captureResultText(normalizeWar({ ...raw(), winner: 2 }, rulesFromEnv())!), /Поражение/)
})

test('persists links, retries failed edits, survives restart and replaces corrected results without duplicates', async () => {
	const rows: any[] = [], edits: any[] = []
	let captures = [raw()], fail = true, fetches = 0
	const original = new TextDisplayBuilder().setContent('Telegram announcement and registration').toJSON()
	const message = { author: { id: 'bot' }, components: [{ toJSON: () => original }], async edit(payload: any) {
		if (fail) throw new Error('Discord unavailable')
		edits.push(payload)
		this.components = payload.components.map((value: any) => ({ toJSON: () => value }))
	} }
	const pool = { async query(sql: string, args: any[] = []) {
		if (sql.startsWith('INSERT')) rows.push({ message_id: args[0], channel_id: args[1], guild_id: args[2], notice: JSON.parse(args[3]), version: null })
		if (sql.startsWith('SELECT')) return { rows: rows.map(row => ({ ...row })) }
		if (sql.startsWith('UPDATE')) rows.find(row => row.message_id === args[0]).version = args[1]
		return { rows: [] }
	} } as unknown as Pool
	const options = { pool, client: { user: { id: 'bot' }, channels: { async fetch() { return { guildId: 'guild', isTextBased: () => true, messages: { async fetch() { return message } } } } } } as unknown as Client,
		env: { FAMILY_WARS_API_KEY: 'test', GUILD_ID: 'guild' }, logger: { error() {} },
		fetchImpl: (async () => { fetches++; return { ok: true, json: async () => ({ code: 200, status: true, result: { serverId: 'RU8', captures } }) } }) as unknown as typeof fetch }
	await createCaptureResults(options).track({ id: 'message', channelId: 'channel', guildId: 'guild' } as Message, notice)
	const service = createCaptureResults(options)
	captures[0].status = 'pending'
	await service.poll()
	assert.equal(edits.length, 0)
	captures[0].status = 'finished'
	await service.poll()
	assert.equal(rows[0].version, null)
	fail = false
	await service.poll()
	assert.equal(edits.length, 1)
	assert.deepEqual(edits[0].components[0], original)
	await service.poll()
	assert.equal(edits.length, 1)
	captures[0].winner = 2
	await service.poll()
	assert.equal(edits.length, 2)
	assert.equal(edits[1].components.length, 2)
	assert.match(rows[0].version, /Поражение/)
	captures = [raw(), { ...raw(), id: 2 }]
	await service.poll()
	assert.equal(edits.length, 2)
	const before = fetches
	await Promise.all([service.poll(), service.poll()])
	assert.equal(fetches, before + 1)
})
