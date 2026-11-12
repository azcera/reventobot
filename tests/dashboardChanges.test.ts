import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import type { Guild } from 'discord.js'
import { editorTokens } from '../frontend/src/lib/editorTokens'
import { createStore } from '../src/dashboard/store'
import { validatePresets } from '../src/features/capture/capturePresets'
import { validateLists } from '../src/services/mclLists'

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
	let row = { revision: 0, value: { templates: { 'promotion.document': 'Hello {name}' }, settings: {} } as Record<string, unknown> }
	const audit: unknown[][] = []
	const query = async (sql: string, params?: unknown[]) => {
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(row)] }
		if (sql.startsWith('UPDATE dashboard_state')) { row = { revision: row.revision + 1, value: JSON.parse(params![0] as string) } }
		if (sql.startsWith('INSERT INTO dashboard_audit')) audit.push(params!)
		return { rows: [] }
	}
	const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool
	const store = createStore()
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
