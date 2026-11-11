import { asMock } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { createFixture, memoryPool } = require('./helpers/dashboardFixture')
const { createSessions }: typeof import("../src/dashboard/sessions") = require('../src/dashboard/sessions')

test('authenticated cookie and CSRF survive a fresh auth instance; logout stays revoked after restart', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const csrf = f.csrf
	const cookie = f.cookie.split('=')[1]
	assert.equal(f.pool.sessions.size, 1)
	assert.equal(f.pool.sessions.has(cookie), false)
	assert.ok(!JSON.stringify([...f.pool.sessions]).includes('oauth-token'))
	f.restartAuth()
	const response = await f.request('/api/session')
	assert.equal(response.status, 200)
	assert.equal((await response.json()).csrf, csrf)
	assert.equal((await f.request('/api/echo', { body: {} })).status, 200)
	assert.equal((await f.request('/api/echo', { body: {}, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403)
	await f.request('/api/logout', { body: {} })
	f.restartAuth()
	assert.equal((await f.request('/api/session')).status, 401)
	assert.equal(f.pool.sessions.size, 0)
})

test('expired and revoked sessions cannot be restored; transient Discord failures do not revoke login', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.client.isReady = () => false; f.restartAuth()
	assert.equal((await f.request('/api/session')).status, 503)
	assert.equal(f.pool.sessions.size, 1)
	f.client.isReady = () => true
	assert.equal((await f.request('/api/session')).status, 200)
	f.setAdmin(false)
	assert.equal((await f.request('/api/session')).status, 403)
	f.setAdmin(true); f.restartAuth()
	assert.equal((await f.request('/api/session')).status, 401)
	await f.login()
	for (const value of f.pool.sessions.values()) value.expires_at = new Date(Date.now() - 1)
	f.restartAuth()
	assert.equal((await f.request('/api/session')).status, 401)
})

test('database sessions are scoped to client and guild and recover after database initialization failure', async () => {
	const pool = memoryPool()
	const options = { clientId: 'client', guildId: 'guild' }
	const sessions = createSessions(asMock(pool), options)
	await sessions.set('hash', { user: { id: 'user' }, csrf: 'csrf', expires: Date.now() + 60000 })
	assert.equal((await createSessions(asMock(pool), options).get('hash'))!.user.id, 'user')
	assert.equal(await createSessions(asMock(pool), { ...options, guildId: 'other' }).get('hash'), undefined)
	assert.equal(await createSessions(asMock(pool), { ...options, clientId: 'other' }).get('hash'), undefined)
	let failed = true
	const recovering = createSessions(asMock({ query: async (...args: [string, (readonly unknown[])?]) => { if (failed) throw new Error('offline'); return pool.query(...args) } }), options)
	await assert.rejects(() => recovering.get('hash'), /offline/)
	failed = false
	assert.equal((await recovering.get('hash'))!.user.id, 'user')
})

test('database failure denies requests without clearing the browser cookie or stored session', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const query = f.pool.query
	f.pool.query = async () => { throw new Error('offline') }
	const response = await f.request('/api/session')
	assert.equal(response.status, 503)
	assert.equal(response.headers.get('set-cookie'), null)
	f.pool.query = query
	assert.equal((await f.request('/api/session')).status, 200)
})
