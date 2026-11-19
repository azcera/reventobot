import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express = require('express')
import type { Client } from 'discord.js'
import type { Pool } from 'pg'
import { createAuth } from '../src/dashboard/auth'

test('dashboard OAuth uses one-time state and scoped sessions, checks CSRF and revokes lost permissions', async t => {
	const now = Date.now()
	const environment = { GUILD_ID: 'guild', CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'fake', DASHBOARD_URL: 'https://test.example' }
	let admin = true
	let unavailable = false
	let calls = 0
	let session: { hash: string; guild: string; client: string; user_data: unknown; csrf: string; expires_at: Date } | undefined
	const pool = { async query(sql: string, values: any[] = []) {
		if (unavailable) throw new Error('DB offline')
		if (sql.startsWith('INSERT')) session = { hash: values[0], client: values[1], guild: values[2], user_data: JSON.parse(values[3]), csrf: values[4], expires_at: values[5] }
		const matching = session && session.hash === values[0] && session.client === values[1] && session.guild === values[2]
		if (sql.startsWith('SELECT')) return { rows: matching ? [session] : [] }
		if (sql.startsWith('DELETE') && matching) session = undefined
		return { rows: [] }
	} } as unknown as Pool
	const guild = { id: 'guild', ownerId: 'owner', roles: { async fetch() {} }, members: { async fetch() {
		calls++
		return { permissions: { has: () => admin } }
	} } }
	const client = { isReady: () => true, guilds: { async fetch({ guild: id }: { guild: string }) {
		assert.equal(id, environment.GUILD_ID)
		return guild
	} } } as unknown as Client
	const request = (async (url: string) => Response.json(url.endsWith('/token')
		? { access_token: 'fake-token' } : { id: 'user', username: 'User' })) as typeof fetch
	const auth = createAuth({ client, pool, env: environment, request })
	const app = express()
	auth.register(app)
	app.get('/session', auth.middleware, (req, res) => res.json({ csrf: req.csrf, guild: req.guild.id }))
	app.post('/write', auth.middleware, (_req, res) => res.sendStatus(204))
	const server = app.listen(0, '127.0.0.1')
	t.after(() => new Promise<void>(resolve => { server.close(() => resolve()) }))
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	const base = 'http://127.0.0.1:' + address.port
	const get = (path: string, init?: RequestInit) => fetch(base + path, { redirect: 'manual', ...init })
	async function begin() {
		const login = await get('/auth/discord')
		const cookie = login.headers.getSetCookie()[0]
		assert.match(cookie, /^__Host-revento-oauth=.*Path=\/.*HttpOnly; Secure; SameSite=Lax/)
		const state = new URL(login.headers.get('location')!).searchParams.get('state')
		return () => get('/auth/discord/callback?code=fixture&state=' + state, { headers: { Cookie: cookie.split(';')[0] } })
	}
	const expired = await begin()
	const clock = t.mock.method(Date, 'now', () => now + 601000)
	assert.match((await expired()).headers.get('location')!, /^\/\?error=/)
	clock.mock.restore()
	const callback = await begin()
	const loggedIn = await callback()
	assert.equal(loggedIn.headers.get('location'), '/')
	const sessionCookie = loggedIn.headers.getSetCookie().find(value => value.startsWith('__Host-revento='))!
	assert.match(sessionCookie, /HttpOnly; Secure; SameSite=Lax/)
	assert.match((await callback()).headers.get('location')!, /^\/\?error=/)
	const cookie = sessionCookie.split(';')[0]
	assert.notEqual(cookie.split('=')[1], session?.hash)
	const status = await (await get('/session', { headers: { Cookie: cookie } })).json()
	assert.equal(status.guild, 'guild')
	assert.equal((await get('/write', { method: 'POST', headers: { Cookie: cookie } })).status, 403)
	assert.equal((await get('/write', { method: 'POST', headers: { Cookie: cookie, Origin: environment.DASHBOARD_URL, 'X-CSRF-Token': status.csrf } })).status, 204)
	unavailable = true
	assert.equal((await get('/session', { headers: { Cookie: cookie } })).status, 503)
	unavailable = false
	admin = false
	assert.equal((await get('/session', { headers: { Cookie: cookie } })).status, 403)
	admin = true
	assert.equal((await get('/session', { headers: { Cookie: cookie } })).status, 401)
	assert.equal(calls, 4)
})
