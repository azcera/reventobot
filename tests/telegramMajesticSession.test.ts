import { test } from 'node:test'
import assert = require('node:assert/strict')
import { createTelegramMajesticSession } from '../src/services/telegramMajesticSession'

test('owner can replace a verified session; failures preserve the old session', async () => {
	const env = { TG_NOTIFICATION_CHAT_ID: '42', MAJESTIC_SESSION_ID: 'old', MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '1' }
	const sent: string[] = []
	let saved = ''
	let fail = true
	const service = createTelegramMajesticSession({ env, now: () => 100000, send: async (_, text) => { sent.push(text) },
		validate: async () => { if (fail) throw new Error('invalid'); return { total: 0, items: [] } },
		save: async value => { saved = value } })
	await service.handleMessage('42', '/session', 100)
	assert.equal(await service.handleMessage('43', 'new', 100), false)
	assert.equal(await service.handleMessage('42', 'new', 99), false)
	await service.handleMessage('42', 'new', 100)
	assert.equal(env.MAJESTIC_SESSION_ID, 'old')
	assert.equal(saved, '')
	fail = false
	await service.handleMessage('42', 'new', 101)
	assert.equal(env.MAJESTIC_SESSION_ID, 'new')
	assert.equal(saved, 'new')
	assert.match(sent.at(-1)!, /обновлена/)
})

test('daily prompt is scheduled for 22:00 Moscow time', async () => {
	let callback: (() => void) | undefined
	let delay = 0
	const messages: string[] = []
	const service = createTelegramMajesticSession({ env: { TG_NOTIFICATION_CHAT_ID: '42' }, now: () => Date.parse('2026-11-11T18:00:00Z'),
		send: async (_, text) => { messages.push(text) },
		setTimer: ((fn: () => void, ms: number) => { callback = fn; delay = ms; return { unref() {} } }) as unknown as typeof setTimeout,
		clearTimer: (() => {}) as typeof clearTimeout })
	service.start()
	assert.equal(delay, 3600000)
	callback!()
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(messages.length, 1)
	service.stop()
})
