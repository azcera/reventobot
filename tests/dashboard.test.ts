import { asMock } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { createStore, store, catalog }: typeof import("../src/dashboard/store") = require('../src/dashboard/store')
const { createAuth }: typeof import("../src/dashboard/auth") = require('../src/dashboard/auth')
const { validateTemplates, validateSettings }: typeof import("../src/dashboard/routes") = require('../src/dashboard/routes')
const { applyFields }: typeof import("../src/dashboard/messageEditor") = require('../src/dashboard/messageEditor')
const { createBroadcastService }: typeof import("../src/services/telegramBroadcastService") = require('../src/services/telegramBroadcastService')
const { memoryPool, createFixture } = require('./helpers/dashboardFixture')
import type { TemplateField } from '../frontend/src/types'

test('schedule API returns local recurring events and upcoming Moscow times behind existing authentication', async t => {
	const f = await createFixture(); t.after(() => f.close())
	assert.equal((await f.request('/api/schedule')).status, 401)
	await f.login()
	const response = await f.request('/api/schedule')
	assert.equal(response.status, 200)
	assert.equal(response.headers.get('cache-control'), 'no-store')
	const data = await response.json()
	assert.equal(data.project, 'MAJESTIC')
	assert.equal(data.timezone, 'Europe/Moscow')
	assert.equal(data.events.length, 20)
	assert.equal(data.upcoming.length, 16)
	assert.ok(data.upcoming.every((event: { timestamp: number }) => event.timestamp > data.generatedAt))
	assert.deepEqual(data.upcoming.map((event: { timestamp: number }) => event.timestamp), data.upcoming.map((event: { timestamp: number }) => event.timestamp).sort((a: number, b: number) => a - b))
})

test('OAuth login binds state to browser, does not replay, protects cookies, enforces CSRF and logs out', async t => {
	const f = await createFixture(); t.after(() => f.close())
	assert.equal((await f.request('/api/session')).status, 401)
	assert.equal((await f.request('/api/echo', { body: {} })).status, 401)
	const start = await f.request('/auth/discord')
	const location = new URL(start.headers.get('location'))
	assert.equal(location.searchParams.get('scope'), 'identify')
	const state = location.searchParams.get('state')
	const stolen = await f.request('/auth/discord/callback?code=code&state=' + state)
	assert.match(stolen.headers.get('location'), /error=/)
	assert.equal(f.tokenCalls, 0)
	const login = await f.login()
	assert.equal(login.headers.get('location'), '/')
	const cookie = login.headers.getSetCookie().find((value: string) => value.startsWith('revento='))
	assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/)
	assert.ok(f.csrf)
	assert.equal((await f.request('/api/echo', { body: {}, headers: { 'X-CSRF-Token': '' } })).status, 403)
	assert.equal((await f.request('/api/echo', { body: {}, headers: { Origin: 'https://evil.test' } })).status, 403)
	assert.equal((await f.request('/api/echo', { body: {} })).status, 200)
	const before = f.tokenCalls
	await f.request('/auth/discord/callback?code=code&state=' + state)
	assert.equal(f.tokenCalls, before)
	assert.equal((await f.request('/api/logout', { body: {} })).status, 200)
	assert.equal((await f.request('/api/session')).status, 401)
})

test('access is checked again after role revocation; owner and optional ID list follow the policy', async t => {
	const f = await createFixture(); t.after(() => f.close())
	await f.login(); f.setAdmin(false)
	assert.equal((await f.request('/api/session')).status, 403)
	f.setAdmin(true)
	assert.equal((await f.request('/api/session')).status, 401)
	f.env.DASHBOARD_ALLOWED_USER_IDS = 'someone-else'
	assert.match((await f.login()).headers.get('location'), /error=/)
	f.env.DASHBOARD_ALLOWED_USER_IDS = f.userId
	f.setAdmin(false); f.guild.ownerId = f.userId
	assert.equal((await f.login()).headers.get('location'), '/')
	assert.equal((await f.request('/api/session')).status, 200)
})

test('unconfigured OAuth and public HTTP origins fail closed', () => {
	for (const env of [{}, { CLIENT_ID: 'a', DISCORD_CLIENT_SECRET: 'b', GUILD_ID: 'c', DASHBOARD_URL: 'http://example.com' }]) {
		const auth = createAuth(asMock({ client: {}, env }))
		const handlers: Record<string, (req: object, res: { json(value: { configured: boolean }): void }) => void> = {}
		auth.register(asMock({ get: (path: string, fn: typeof handlers[string]) => { handlers[path] = fn } }))
		let result: { configured: boolean } | undefined
		handlers['/auth/status']({}, { json(value) { result = value } })
		assert.equal(result?.configured, false)
	}
})

test('OAuth uses the existing CLIENT_ID and accepts either supported Client Secret name', async t => {
	for (const secretKey of ['DISCORD_CLIENT_SECRET', 'CLIENT_SECRET']) {
		const f = await createFixture({ secretKey }); t.after(() => f.close())
		const start = await f.request('/auth/discord')
		assert.equal(new URL(start.headers.get('location')).searchParams.get('client_id'), f.env.CLIENT_ID)
		assert.equal((await f.login()).headers.get('location'), '/')
		assert.equal(f.oauthTokens[0].client_id, f.env.CLIENT_ID)
		assert.equal(f.oauthTokens[0].client_secret, f.env[secretKey])
		assert.equal(f.env.DISCORD_CLIENT_ID, undefined)
	}
})

test('all existing builder APIs reject cross-server messages and channels before Discord mutation', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const link = f.message.url.replace(f.guild.id, '999999999999999999')
	assert.equal((await f.request('/api/container-message?link=' + encodeURIComponent(link))).status, 403)
	assert.equal((await f.request('/api/edit-container', { body: { link } })).status, 403)
	assert.equal((await f.request('/api/echo', { body: { channelId: '999999999999999999' } })).status, 403)
	assert.equal((await f.request('/api/channel-info?id=999999999999999999')).status, 403)
	assert.equal(f.message.lastPayload, undefined)
})

test('removed standalone message editor endpoints no longer read or mutate Discord messages', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	assert.equal((await f.request('/api/message?link=' + encodeURIComponent(f.message.url))).status, 404)
	assert.equal((await f.request('/api/message', { body: { link: f.message.url, values: {} } })).status, 404)
	assert.equal(f.message.lastPayload, undefined)
})


test('field editor rejects ID/structure changes, invalid links and excessive text', async t => {
	const f = await createFixture(); t.after(() => f.close())
	const original = structuredClone(f.message.components)
	assert.throws(() => applyFields(f.message, { 'components.0.components.1.accessory.0.custom_id': 'evil' }), /Недопустимое поле/)
	assert.throws(() => applyFields(f.message, { 'components.0.components.0.content': 'a'.repeat(4001) }), /слишком длинный/)
	assert.throws(() => applyFields(f.message, { 'components.0.accent_color': '#ffff' }), /Недопустимое поле/)
	assert.throws(() => applyFields(f.message, { 'components.0.components.0.content': 'a'.repeat(3999) }), /Общая длина/)
	f.message.components[0].components[1].accessory = { type: 2, style: 5, label: 'Link', url: 'https://example.com' }
	assert.throws(() => applyFields(f.message, { 'components.0.components.1.accessory.0.url': 'javascript:alert(1)' }), /HTTPS/)
	f.message.components = original
	assert.deepEqual(f.message.components, original)
})

test('removed message editor cannot edit dynamic capture publications', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.pool.dynamic.add(f.message.id)
	assert.equal((await f.request('/api/message?link=' + encodeURIComponent(f.message.url))).status, 404)
	assert.equal(f.message.lastPayload, undefined)
})


test('template and settings changes persist, affect rendering immediately and reject old revisions', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const response = await f.request('/api/templates', { body: { revision: 0, values: { 'capture.title': '## Набор на {target}' } } })
	assert.equal(response.status, 200)
	assert.equal(store.text('capture.title', { target: 'мероприятие' }), '## Набор на мероприятие')
	const setting = await f.request('/api/settings', { body: { revision: 1, values: { PLUS_CHANNEL_ID: f.channelId, TELEGRAM_BROADCAST_ENABLED: false } } })
	assert.equal(setting.status, 200)
	assert.equal(store.getSetting('PLUS_CHANNEL_ID'), f.channelId)
	assert.equal(store.getSetting('TELEGRAM_BROADCAST_ENABLED'), false)
	assert.equal((await f.request('/api/templates', { body: { revision: 0, values: { 'capture.title': '{target}' } } })).status, 409)
	const restarted = createStore(); await restarted.init(f.pool)
	assert.equal(restarted.text('capture.title', { target: 'капт' }), '## Набор на капт')
	assert.equal(restarted.getSetting('TELEGRAM_BROADCAST_ENABLED'), false)
	assert.equal(restarted.revision, 2)
	const reset = await f.request('/api/templates', { body: { revision: 2, values: { 'capture.title': null } } })
	assert.equal(reset.status, 200)
	assert.equal(store.text('capture.title', { target: 'капт' }), catalog['capture.title'].default!.replace('{target}', 'капт'))
})

test('template variables, color, lengths, unknown settings and wrong channel types are validated', async t => {
	const f = await createFixture(); t.after(() => f.close())
	for (const values of [{ 'capture.title': 'Без цели' }, { 'capture.title': '{evil}' }, { 'missing.key': 'text' }, { 'rules.1': 'http://example.com' }, { 'rules.1': 'https://' }, { 'capture.color': '#00000' }, JSON.parse('{"__proto__":null}')]) assert.throws(() => validateTemplates(values))
	for (const [key, field] of Object.entries(catalog as Record<string, TemplateField>).filter(([key]) => require('../src/dashboard/store').templateDefinition(key))) assert.doesNotThrow(() => validateTemplates({ [key]: field.default! }), key)
	assert.doesNotThrow(() => validateTemplates({ 'schedule.banner': '' }))
	assert.doesNotThrow(() => validateTemplates({ 'schedule.banner': 'https://example.com/custom.png' }))
	assert.throws(() => validateTemplates({ 'schedule.banner': '<img src="https://example.com/custom.png" />' }))
	for (const key of ['schedule.title', 'announcement.title', 'announcement.banner']) assert.throws(() => validateTemplates({ [key]: 'Текст' }))
	await assert.rejects(() => validateSettings({ TOKEN: 'secret' }, f.guild), /Неизвестная/)
	await assert.rejects(() => validateSettings(JSON.parse('{"__proto__":""}'), f.guild), /Неизвестная/)
	await assert.rejects(() => validateSettings({ INVITE_CATEGORY_ID: f.channelId }, f.guild), /Недопустимый/)
	await assert.rejects(() => validateSettings({ TELEGRAM_BROADCAST_ENABLED: 'false' }, f.guild), /переключатель/)
	await assert.doesNotReject(() => validateSettings({ PLUS_CHANNEL_ID: f.channelId }, f.guild))
})

test('store rolls back failures and render substitution never interprets user-provided variables recursively', async () => {
	const pool = memoryPool()
	const local = createStore(); await local.init(pool)
	await local.save('templates', { 'capture.title': '{target}' }, 0, 'admin')
	assert.equal(local.text('capture.title', { target: '{user}' }), '{user}')
	await assert.rejects(() => local.save('settings', {}, 0, 'admin'), (error: unknown) => error instanceof Error && 'status' in error && error.status === 409)
	assert.equal(local.revision, 1)
	assert.ok(pool.queries.includes('ROLLBACK'))
})

test('paused Telegram delivery does not take queued jobs or call the network', async () => {
	const service = createBroadcastService(asMock({ token: 'unused', isEnabled: () => false,
		pool: { query() { throw new Error('queue must remain untouched') } }, request() { throw new Error('network must not be called') } }))
	assert.equal(await service.deliverOne(), false)
	await service.stop()
})

test('expired sessions and unavailable Discord cannot reuse previously granted access', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.client.isReady = () => false
	assert.equal((await f.request('/api/session')).status, 503)
	f.client.isReady = () => true
	const future = Date.now() + 9 * 3600000
	t.mock.method(Date, 'now', () => future)
	assert.equal((await f.request('/api/session')).status, 401)
})

test('failed audit insert rolls back saved data and leaves the running cache unchanged', async () => {
	const database = memoryPool()
	const local = createStore(); await local.init(database)
	const connect = database.connect
	database.connect = async () => {
		const db = await connect()
		return { release: db.release, query: (sql: string, params?: readonly unknown[]) => {
			if (sql.startsWith('INSERT INTO dashboard_audit')) throw new Error('audit unavailable')
			return db.query(sql, params)
		} }
	}
	await assert.rejects(() => local.save('settings', { TELEGRAM_BROADCAST_ENABLED: false }, 0, 'admin'), /audit unavailable/)
	assert.equal(local.revision, 0)
	assert.equal(local.getSetting('TELEGRAM_BROADCAST_ENABLED'), true)
	const restarted = createStore(); await restarted.init(database)
	assert.equal(restarted.revision, 0)
	assert.equal(restarted.getSetting('TELEGRAM_BROADCAST_ENABLED'), true)
})
