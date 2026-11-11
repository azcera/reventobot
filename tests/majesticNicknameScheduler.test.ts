import { asMock } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { createMajesticNicknameScheduler, INTERVAL_MS }: typeof import("../src/services/majesticNicknameScheduler") = require('../src/services/majesticNicknameScheduler')

function fixture() {
	const timers: { callback(): Promise<void>; delay: number }[] = [], calls: string[][] = []
	const store = { ready: true, getSetting: () => true }
	const env: Record<string, string> = { GUILD_ID: 'guild', MAJESTIC_SESSION_ID: 'fake', MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '289229' }
	const sync = { autoNicknames: async (guild: { id: string }): Promise<object | null> => { calls.push(['sync', guild.id]); return {} },
		wait: async () => { calls.push(['wait']) }, stop: async () => { calls.push(['stop']) } }
	const client = { guilds: { fetch: async (id: string) => ({ id }) } }
	const scheduler = createMajesticNicknameScheduler(asMock({ client, sync, store, env,
		setTimer: (callback: () => Promise<void>, delay: number) => { timers.push({ callback, delay }); return timers.length }, clearTimer: () => {}, logger: { error() {} } }))
	return { timers, calls, scheduler, sync, store, env, client }
}

test('sync scheduler starts immediately then waits ten minutes after completion', async () => {
	const f = fixture(); f.scheduler.start(); f.scheduler.start()
	assert.equal(f.timers.length, 1); assert.equal(f.timers[0].delay, 0)
	await f.timers[0].callback()
	assert.deepEqual(f.calls, [['sync', 'guild'], ['wait']])
	assert.equal(INTERVAL_MS, 10 * 60 * 1000)
	assert.equal(f.timers[1].delay, INTERVAL_MS)
	await f.scheduler.stop()
	await f.timers[1].callback()
	assert.equal(f.calls.length, 2)
})

test('disabled, unconfigured or not-ready scheduler skips work and keeps its next check', async () => {
	for (const disable of [(f: ReturnType<typeof fixture>) => { f.store.getSetting = () => false }, (f: ReturnType<typeof fixture>) => { f.store.ready = false }, (f: ReturnType<typeof fixture>) => { delete f.env.MAJESTIC_SESSION_ID }]) {
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
	let release!: () => void, entered!: () => void
	const gate = new Promise<void>(resolve => { release = resolve })
	const running = new Promise<void>(resolve => { entered = resolve })
	f.sync.wait = async () => { entered(); await gate }
	f.scheduler.start(); const tick = f.timers[0].callback(); await running
	const stop = f.scheduler.stop(); release(); await Promise.all([tick, stop])
	assert.ok(f.calls.some(call => call[0] === 'stop'))
	assert.equal(f.timers.length, 1)
})

test('scheduler logs the failing stage and only safe error fields', async () => {
	const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
		['discord.guild.fetch', f => { f.client.guilds.fetch = async () => { throw Object.assign(new Error('secret'), { name: 'DiscordFailure', code: '10062;secret' }) } }],
		['sync.start', f => { f.sync.autoNicknames = async () => { throw Object.assign(new Error('secret'), { code: 'START_FAILED' }) } }],
		['sync.wait', f => { f.sync.wait = async () => { throw Object.assign(new Error('secret'), { code: 'WAIT_FAILED' }) } }]
	]
	for (const [stage, fail] of cases) {
		const logs: unknown[][] = [], f = fixture()
		f.scheduler = createMajesticNicknameScheduler(asMock({ client: f.client, sync: f.sync, store: f.store, env: f.env,
			setTimer: (callback: () => Promise<void>, delay: number) => { f.timers.push({ callback, delay }); return f.timers.length }, clearTimer: () => {}, logger: { error: (...args: unknown[]) => logs.push(args) } }))
		fail(f); f.scheduler.start(); await f.timers[0].callback()
		assert.deepEqual(logs[0][1], { stage, name: stage === 'discord.guild.fetch' ? 'DiscordFailure' : 'Error', code: stage === 'discord.guild.fetch' ? '' : stage === 'sync.start' ? 'START_FAILED' : 'WAIT_FAILED' })
		assert.ok(!JSON.stringify(logs).includes('secret'))
		await f.scheduler.stop()
	}
})
