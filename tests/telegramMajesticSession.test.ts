import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path = require('node:path')
import type { Pool } from 'pg'
import type { Guild } from 'discord.js'
import type { Store } from '../src/types'
import { createTelegramMajesticSession, loadSavedMajesticSession } from '../src/services/telegramMajesticSession'
import { createMajesticSync } from '../src/services/majesticSync'

function database() {
	let value: string | undefined
	let fail = false
	const pool = { async query(sql: string, params?: string[]) {
		if (fail) throw new Error('fixture database unavailable')
		if (sql.startsWith('INSERT INTO majestic_session') && (!value || sql.includes('DO UPDATE'))) value = params![0]
		return { rows: sql.startsWith('SELECT value FROM majestic_session') && value ? [{ value }] : [] }
	} } as unknown as Pool
	return { pool, get value() { return value }, setFail() { fail = true } }
}

const environment = () => ({ TG_NOTIFICATION_CHAT_ID: 'chat', MAJESTIC_SESSION_ID: 'old-session',
	MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '289229' })

test('Telegram session survives republish without a local file and overrides stale env before sync', async () => {
	const db = database()
	const env = environment()
	const messages: string[] = []
	const session = createTelegramMajesticSession({ pool: db.pool, env, now: () => 100000,
		send: async (_chat, text) => { messages.push(text) },
		validate: async config => { assert.equal(config.sessionId, 'new-session'); return { total: 1, items: [] } } })
	await session.handleMessage('chat', '/session')
	await session.handleMessage('chat', 'new-session', 100)
	assert.equal(db.value, 'new-session')
	assert.equal(env.MAJESTIC_SESSION_ID, 'new-session')
	const restarted = environment()
	const sync = createMajesticSync({ pool: db.pool, env: restarted, store: {} as Store })
	assert.equal((await sync.state({ id: 'guild' } as Guild)).configured, true)
	assert.equal(restarted.MAJESTIC_SESSION_ID, 'new-session')
	assert.ok(messages.at(-1)?.includes('обновлена'))
	assert.ok(messages.every(text => !text.includes('new-session')))
})

for (const failure of ['validation', 'database']) test(`failed ${failure} keeps previous session`, async () => {
	const db = database()
	const env = environment()
	const session = createTelegramMajesticSession({ pool: db.pool, env, now: () => 100000,
		send: async () => {}, validate: async () => {
			if (failure === 'validation') throw new Error('HTTP 401')
			db.setFail()
			return { total: 1, items: [] }
		} })
	await session.handleMessage('chat', '/session')
	await session.handleMessage('chat', 'new-session', 100)
	assert.equal(env.MAJESTIC_SESSION_ID, 'old-session')
	assert.equal(db.value, undefined)
})

test('legacy file migrates once; database wins over both file and env', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'revento-session-'))
	try {
		const file = path.join(directory, '.majestic-session')
		const db = database()
		const env = environment()
		await loadSavedMajesticSession(db.pool, env, file)
		assert.equal(env.MAJESTIC_SESSION_ID, 'old-session')
		await writeFile(file, 'legacy-session')
		await loadSavedMajesticSession(db.pool, env, file)
		assert.equal(db.value, 'legacy-session')
		await writeFile(file, 'obsolete-file-session')
		env.MAJESTIC_SESSION_ID = 'old-session'
		await loadSavedMajesticSession(db.pool, env, file)
		assert.equal(env.MAJESTIC_SESSION_ID, 'legacy-session')
		await rm(file)
		await loadSavedMajesticSession(db.pool, env, file)
		assert.equal(env.MAJESTIC_SESSION_ID, 'legacy-session')
	} finally { await rm(directory, { recursive: true, force: true }) }
})
