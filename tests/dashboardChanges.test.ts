import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import type { Guild } from 'discord.js'
import { editorTokens } from '../frontend/src/lib/editorTokens'
import { createStore } from '../src/dashboard/store'
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
