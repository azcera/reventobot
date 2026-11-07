const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMajesticNicknameScheduler, INTERVAL_MS } = require('../src/services/majesticNicknameScheduler')

function fixture() {
	const timers = [], calls = []
	const store = { ready: true, getSetting: () => true }
	const env = { GUILD_ID: 'guild', MAJESTIC_SESSION_ID: 'fake', MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '289229' }
	const sync = { autoNicknames: async guild => { calls.push(['sync', guild.id]); return {} },
		wait: async () => { calls.push(['wait']) }, stop: async () => { calls.push(['stop']) } }
	const scheduler = createMajesticNicknameScheduler({ client: { guilds: { fetch: async id => ({ id }) } }, sync, store, env,
		setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, clearTimer: () => {}, logger: { error() {} } })
	return { timers, calls, scheduler, sync, store, env }
}

test('nickname scheduler starts immediately then waits five minutes after completion', async () => {
	const f = fixture(); f.scheduler.start(); f.scheduler.start()
	assert.equal(f.timers.length, 1); assert.equal(f.timers[0].delay, 0)
	await f.timers[0].callback()
	assert.deepEqual(f.calls, [['sync', 'guild'], ['wait']])
	assert.equal(f.timers[1].delay, INTERVAL_MS)
	await f.scheduler.stop()
	await f.timers[1].callback()
	assert.equal(f.calls.length, 2)
})

test('disabled, unconfigured or not-ready scheduler skips work and keeps its next check', async () => {
	for (const disable of [f => { f.store.getSetting = () => false }, f => { f.store.ready = false }, f => { delete f.env.MAJESTIC_SESSION_ID }]) {
		const f = fixture(); disable(f); f.scheduler.start(); await f.timers[0].callback()
		assert.equal(f.calls.length, 0); assert.equal(f.timers.length, 2)
		await f.scheduler.stop()
	}
})

test('busy manual jobs are skipped and stopping an active automatic pass requests a stop', async () => {
	const skipped = fixture(); skipped.sync.autoNicknames = async () => null
	skipped.scheduler.start(); await skipped.timers[0].callback()
	assert.equal(skipped.calls.length, 0); await skipped.scheduler.stop()
	const f = fixture()
	let release, entered
	const gate = new Promise(resolve => { release = resolve })
	const running = new Promise(resolve => { entered = resolve })
	f.sync.wait = async () => { entered(); await gate }
	f.scheduler.start(); const tick = f.timers[0].callback(); await running
	const stop = f.scheduler.stop(); release(); await Promise.all([tick, stop])
	assert.ok(f.calls.some(call => call[0] === 'stop'))
	assert.equal(f.timers.length, 1)
})
