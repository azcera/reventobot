import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import { createBroadcastService } from '../src/services/telegramBroadcastService'
import { startRuntimeDiagnostics } from '../src/services/runtimeDiagnostics'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

for (const stopBeforeRetry of [false, true]) test(`polling state failure recovers; stop before retry: ${stopBeforeRetry}`, async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const errors = t.mock.method(console, 'error', () => {})
	let reads = 0, polls = 0
	const pool = {
		totalCount: 2, idleCount: 1, waitingCount: 0,
		async query(sql: string) {
			if (sql.startsWith('SELECT update_offset')) {
				reads++
				if (reads === 1) throw new Error('Connection terminated due to connection timeout')
				return { rows: [{ update_offset: 42 }] }
			}
			return { rows: [] }
		}
	} as unknown as Pool
	const request: typeof fetch = async (url, init) => {
		if (String(url).endsWith('/getUpdates')) {
			polls++
			assert.equal(JSON.parse(String(init?.body)).offset, 42)
			return new Promise((_resolve, reject) => {
				init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
			})
		}
		return new Response(JSON.stringify({ ok: true, result: { url: '' } }))
	}
	const service = createBroadcastService({ pool, token: 'fixture', request })
	t.after(() => service.stop())
	await service.start()
	await flush()
	assert.equal(reads, 1)
	assert.equal(errors.mock.calls.length, 1)
	assert.match(String(errors.mock.calls[0].arguments[0]), /Получение команд: перезапуск/)
	const diagnostic = (errors.mock.calls[0].arguments as unknown[])[1] as { connectionTimeout: boolean; pool: object }
	assert.equal(diagnostic.connectionTimeout, true)
	assert.deepEqual(diagnostic.pool, { total: 2, idle: 1, waiting: 0 })
	if (stopBeforeRetry) await service.stop()
	t.mock.timers.tick(5000)
	await flush()
	assert.equal(reads, stopBeforeRetry ? 1 : 2)
	assert.equal(polls, stopBeforeRetry ? 0 : 1)
	await service.stop()
	const stoppedReads = reads
	t.mock.timers.tick(60000)
	await flush()
	assert.equal(reads, stoppedReads)
	assert.equal(errors.mock.calls.length, 1)
})

test('runtime diagnostics logs pool state locally and stops on shutdown', t => {
	t.mock.timers.enable({ apis: ['setInterval'] })
	const logs = t.mock.method(console, 'log', () => {})
	const errors = t.mock.method(console, 'error', () => {})
	const pool = { totalCount: 20, idleCount: 0, waitingCount: 3 }
	const stop = startRuntimeDiagnostics(pool)
	t.after(stop)
	t.mock.timers.tick(60000)
	assert.equal(logs.mock.calls.length, 1)
	const args = logs.mock.calls[0].arguments as unknown[]
	assert.equal(args[0], '[Runtime]')
	assert.deepEqual((args[1] as { pool: object }).pool, { total: 20, idle: 0, waiting: 3 })
	assert.equal(errors.mock.calls.length, 0)
	stop()
	t.mock.timers.tick(60000)
	assert.equal(logs.mock.calls.length, 1)
})
