import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import type { Guild } from 'discord.js'
import { editorTokens } from '../frontend/src/lib/editorTokens'
import { createStore, store as dashboardStore } from '../src/dashboard/store'
import { registerDashboard } from '../src/dashboard/routes'
import type { Express, Request, Response } from 'express'
import type { Client } from 'discord.js'
import { parse } from '../public/component-markdown'
import { validatePresets } from '../src/features/capture/capturePresets'
import { validateLists } from '../src/services/mclLists'
import { updateLists } from '../src/features/archive/updateLists'
import type { DashboardState } from '../src/types'

test('settings migrate once from env without overwriting DB values and remain in DB after restart', async () => {
	let row = { revision: 4, value: { templates: {}, settings: { AUTO_ROLE: 'saved', ADMIN_ROLES: '' } } as DashboardState }
	const query = async (sql: string, params?: unknown[]) => {
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(row)] }
		if (sql.startsWith('UPDATE dashboard_state')) row = { revision: row.revision + 1, value: JSON.parse(params![0] as string) }
		return { rows: [] }
	}
	const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool
	const store = createStore({ AUTO_ROLE: 'old', ADMIN_ROLES: 'old-admin', PING_CHANNEL_ID: ' channel ', MAJESTIC_AUTO_KICK: 'false', TOKEN: 'secret', PLUS_CHANNEL_ID: ' ' })
	assert.equal(store.getSetting('PING_CHANNEL_ID'), '')
	await store.init(pool)
	assert.equal(store.getSetting('AUTO_ROLE'), 'saved')
	assert.equal(store.getSetting('ADMIN_ROLES'), '')
	assert.equal(store.getSetting('PING_CHANNEL_ID'), 'channel')
	assert.equal(store.getSetting('MAJESTIC_AUTO_KICK'), false)
	assert.equal(store.getSetting('PLUS_CHANNEL_ID'), '')
	assert.equal(Object.hasOwn(row.value.settings, 'TOKEN'), false)
	assert.equal(row.revision, 5)
	const restarted = createStore({ PING_CHANNEL_ID: 'changed', PLUS_CHANNEL_ID: 'late-env-value' })
	await restarted.init(pool)
	assert.equal(restarted.getSetting('PING_CHANNEL_ID'), 'channel')
	assert.equal(restarted.getSetting('PLUS_CHANNEL_ID'), '')
	assert.equal(row.revision, 5)
	await restarted.save('settings', { PING_CHANNEL_ID: 'new-channel' }, 5, 'tester')
	const withoutEnv = createStore({})
	await withoutEnv.init(pool)
	assert.equal(withoutEnv.getSetting('PING_CHANNEL_ID'), 'new-channel')
	await withoutEnv.save('settings', { PING_CHANNEL_ID: null }, 6, 'tester')
	assert.equal(withoutEnv.getSetting('PING_CHANNEL_ID'), '')
	assert.equal(withoutEnv.getSetting('TELEGRAM_BROADCAST_ENABLED'), true)
})

test('failed settings migration rolls back and does not mark store ready', async () => {
	const statements: string[] = []
	const query = async (sql: string) => {
		statements.push(sql)
		if (sql.startsWith('SELECT revision')) return { rows: [{ revision: 0, value: { templates: {}, settings: {} } }] }
		if (sql.startsWith('UPDATE dashboard_state')) throw new Error('database unavailable')
		return { rows: [] }
	}
	const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool
	const store = createStore({ AUTO_ROLE: 'role' })
	await assert.rejects(store.init(pool), /database unavailable/)
	assert.equal(store.ready, false)
	assert.equal(statements.at(-1), 'ROLLBACK')
})

test('empty archive settings skip Discord requests and preserve existing messages', async () => {
	const guild = { get channels() { throw new Error('Discord must not be accessed') } } as unknown as Guild
	await updateLists(guild)
})

test('editor tokens preserve source and ignore inline and fenced code', () => {
	const source = '`[skip](https://example.com)`\n```md\n<img src="https://skip">\n```\n[link](https://example.com) <img src="https://img"> <section title="a">body</section>'
	const tokens = editorTokens(source)
	assert.deepEqual(tokens.map(token => token.kind), ['link', 'image', 'section'])
	for (const token of tokens) assert.equal(source.slice(token.start, token.end), token.source)
	assert.deepEqual(editorTokens(source, false).map(token => token.kind), ['link'])
})

test('capture role validation supports old single and comma-separated roles', () => {
	const guild = { id: 'guild', roles: { cache: new Map([['one', {}], ['two', {}], ['guild', {}]]) }, channels: { cache: new Map([['channel', { type: 0, permissionsFor: () => ({ has: () => true }) }]]) }, members: { me: {} } } as unknown as Guild
	const preset = { id: '12345678-1234-1234-1234-123456789012', command: 'test', target: 'target', channelId: 'channel', accessRoleId: '', maxMain: 10 }
	for (const accessRoleId of ['', 'one', 'one,two']) assert.equal(validatePresets([{ ...preset, accessRoleId }], guild)[0].accessRoleId, accessRoleId)
	for (const accessRoleId of ['one,missing', 'guild']) assert.throws(() => validatePresets([{ ...preset, accessRoleId }], guild))
})

test('list role validation supports single and multiple roles and rejects missing roles', () => {
	const guild = { id: 'guild', roles: { cache: new Map([['one', {}], ['two', {}], ['guild', {}]]) }, channels: { cache: new Map([['channel', { type: 0 }]]) } } as unknown as Guild
	const list = { id: '12345678-1234-1234-1234-123456789012', title: 'List', channelId: 'channel', roleId: 'one', addName: 'Add', removeName: 'Remove' }
	for (const accessRoleId of [undefined, '', 'one', 'one,two']) assert.doesNotThrow(() => validateLists([{ ...list, accessRoleId }], guild))
	for (const accessRoleId of ['one,missing', 'guild']) assert.throws(() => validateLists([{ ...list, accessRoleId }], guild))
})

test('variables save, replace at runtime, preserve snapshot source and reject stale revisions', async () => {
	let row = { revision: 0, value: { templates: { 'promotion.document': 'Hello {name}' }, settings: {}, settingsEnvMigrated: true } as Record<string, unknown> }
	const audit: unknown[][] = []
	const query = async (sql: string, params?: unknown[]) => {
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(row)] }
		if (sql.startsWith('UPDATE dashboard_state')) { row = { revision: row.revision + 1, value: JSON.parse(params![0] as string) } }
		if (sql.startsWith('INSERT INTO dashboard_audit')) audit.push(params!)
		return { rows: [] }
	}
	const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool
	const store = createStore({})
	await store.init(pool)
	await store.save('templateVariables', { 'Система повышения': { name: 'World' } }, 0, 'tester')
	assert.equal(store.text('promotion.document'), 'Hello World')
	assert.equal(store.text('promotion.document', { name: 'Alice' }), 'Hello Alice')
	assert.equal(store.snapshot().templates.find(field => field.key === 'promotion.document')?.value, 'Hello {name}')
	assert.equal(audit.length, 1)
	await assert.rejects(store.save('templateVariables', { 'Система повышения': {} }, 0), { status: 409 })
	await store.save('templateVariables', { 'Система повышения': {} }, 1)
	assert.equal(store.text('promotion.document'), 'Hello {name}')
})

test('variable endpoint validates keys and labels and persists section substitutions', async () => {
	const source = '<section buttonLabel="Открыть" buttonLink="https://example.com">Цена: {цена-пулик}, {цена-спешик}</section>'
	let row = { revision: 0, value: { templates: { 'promotion.document': source }, settings: {}, settingsEnvMigrated: true } as DashboardState }
	const audit: unknown[][] = []
	const query = async (sql: string, params?: unknown[]) => {
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(row)] }
		if (sql.startsWith('UPDATE dashboard_state')) row = { revision: row.revision + 1, value: JSON.parse(params![0] as string) }
		if (sql.startsWith('INSERT INTO dashboard_audit')) audit.push(params!)
		return { rows: [] }
	}
	const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool
	await dashboardStore.init(pool)
	const handlers: Record<string, (req: Request, res: Response) => Promise<void>> = {}
	const app = { use() {}, get() {}, post(path: string, handler: typeof handlers[string]) { handlers[path] = handler } } as unknown as Express
	const auth = { register() {}, middleware() {}, logout() {} }
	registerDashboard(app, { majesticSync: {} } as unknown as Client, pool, { auth: auth as never })
	async function request(body: unknown) {
		let status = 200, json: any
		const res = { status(code: number) { status = code; return this }, json(value: unknown) { json = value; return this } }
		await handlers['/api/template-variables']({ body, guild: {}, dashboardUser: { id: 'tester' } } as Request, res as unknown as Response)
		return { status, json }
	}
	const group = 'Система повышения', values = { 'цена-пулик': '100', 'цена-спешик': '200' }, labels = { 'цена-пулик': 'Цена пулемёта', 'цена-спешик': 'Цена спешика' }
	assert.equal((await request({ group, values, labels, revision: 0 })).status, 200)
	assert.deepEqual(dashboardStore.snapshot().templateVariableLabels[group], labels)
	assert.equal(dashboardStore.snapshot().templates.find(field => field.key === 'promotion.document')?.value, source)
	const section = parse(dashboardStore.text('promotion.document'))[0]
	assert.equal(section.type, 'section'); assert.equal(section.value, 'Цена: 100, 200')
	assert.match(String(audit[0][3]), /Цена пулемёта/)
	const reloaded = createStore({}); await reloaded.init(pool)
	assert.deepEqual(reloaded.templateVariableLabels[group], labels)
	assert.equal(reloaded.text('promotion.document'), dashboardStore.text('promotion.document'))
	const reservedField = dashboardStore.snapshot().templates.find(field => field.variables?.length)!
	for (const body of [
		{ group, values: { 'плохой ключ': 'x' }, revision: 1 },
		{ group: reservedField.group, values: { [reservedField.variables![0]]: 'x' }, revision: 1 },
		{ group, values, labels: { missing: 'Чужой ключ' }, revision: 1 },
		{ group, values, labels: { 'цена-пулик': 'x'.repeat(101) }, revision: 1 }
	]) assert.equal((await request(body)).status, 400)
	assert.equal(row.revision, 1)
	assert.equal((await request({ group, values, revision: 1 })).status, 200)
	assert.deepEqual(dashboardStore.templateVariableLabels[group], labels)
})
