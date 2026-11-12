import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, MessageFlags, PermissionFlagsBits } from 'discord.js'
import type { BotCommand, CapturePreset } from '../src/types'
import { asMock, moduleStub } from './helpers/moduleStub'
import { createFixture, memoryPool } from './helpers/dashboardFixture'
import { createStore } from '../src/dashboard/store'

const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = moduleStub({ id: databasePath, filename: databasePath, loaded: true, exports: {} })
const sent: unknown[][] = []
const managerPath = require.resolve('../src/features/capture/captureManager')
require.cache[managerPath] = moduleStub({ id: managerPath, filename: managerPath, loaded: true, exports: { sendCollection: async (...args: unknown[]) => { sent.push(args) } } })
const { createCapturePresets, validatePresets }: typeof import('../src/features/capture/capturePresets') = require('../src/features/capture/capturePresets')

const preset: CapturePreset = { id: '11111111-1111-4111-8111-111111111111', command: 'сбор-тренировка', target: 'Тренировка', channelId: 'channel', accessRoleId: 'organizer', maxMain: 15 }

test('preset API requires dashboard authentication, CSRF and administrator rights', async t => {
	const f = await createFixture(); t.after(() => f.close())
	assert.equal((await f.request('/api/capture-presets')).status, 401)
	await f.login()
	const response = await f.request('/api/capture-presets')
	assert.equal(response.status, 200)
	assert.deepEqual((await response.json()).presets, [])
	assert.equal((await f.request('/api/capture-presets', { body: { presets: [], revision: 0 }, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403)
	assert.equal((await f.request('/api/capture-presets', { body: { presets: [] } })).status, 400)
	f.setAdmin(false)
	assert.equal((await f.request('/api/capture-presets')).status, 403)
})

async function fixture() {
	const store = createStore(), pool = memoryPool()
	await store.init(asMock(pool))
	const tracked = new Set<string>(), remote = new Collection<string, { name: string; type: number; delete(): Promise<void> }>()
	const created: string[] = [], deleted: string[] = []
	const guild = { id: 'guild', members: { me: {} },
		channels: { fetch: async () => {}, cache: new Collection([['channel', { type: 0, permissionsFor: () => ({ has: () => true }) }]]) },
		roles: { fetch: async () => {}, cache: new Collection([['organizer', {}]]) },
		commands: { fetch: async () => remote, create: async (data: { name: string }) => {
			created.push(data.name); remote.set(data.name, { name: data.name, type: 1, delete: async () => { remote.delete(data.name); deleted.push(data.name) } })
		} }
	}
	const client = { commands: new Collection<string, BotCommand>() }
	const db = { ...pool, query: async (sql: string, params: string[] = []) => {
		if (sql.startsWith('SELECT name FROM capture_preset_commands')) return { rows: [...tracked].map(name => ({ name })) }
		if (sql.startsWith('INSERT INTO capture_preset_commands')) tracked.add(params[1])
		if (sql.startsWith('DELETE FROM capture_preset_commands')) tracked.delete(params[1])
		return pool.query(sql, params)
	} }
	const service = createCapturePresets(asMock({ client, pool: db, store }))
	const replies: { content: string; flags?: number }[] = [], modals: { toJSON(): { components: unknown[] } }[] = []
	let admin = false
	const roles = new Collection([['organizer', {}]])
	const interaction = { guild, commandName: preset.command, customId: 'modal_capture_preset_' + preset.id,
		member: { permissions: { has: (flag: bigint) => admin && flag === PermissionFlagsBits.Administrator }, roles: { cache: roles } },
		isChatInputCommand: () => true, fields: { getTextInputValue: () => '12.11.2026 18:30' },
		showModal: async (modal: typeof modals[number]) => { modals.push(modal) },
		reply: async (payload: typeof replies[number]) => { replies.push(payload) }, deferReply: async () => {}, editReply: async (content: string) => { replies.push({ content }) }
	}
	return { store, pool, service, guild, client, interaction, replies, modals, created, deleted, remote, roles, setAdmin() { admin = true } }
}

test('preset save persists audited settings and reconciles renamed/deleted commands without touching /capt', async () => {
	const f = await fixture()
	f.remote.set('capt', { name: 'capt', type: 1, delete: async () => assert.fail('ordinary registration removed') })
	await f.service.save(asMock(f.guild), [preset], 0, { id: 'admin', name: 'Admin' })
	assert.equal(f.store.capturePresets[preset.id].maxMain, 15)
	assert.ok(f.pool.queries.some(sql => sql.startsWith('INSERT INTO dashboard_audit')))
	await f.service.save(asMock(f.guild), [{ ...preset, command: 'тренировка' }], 1, { id: 'admin' })
	assert.deepEqual(f.deleted, [preset.command])
	assert.ok(!f.client.commands.has(preset.command))
	await assert.rejects(f.service.save(asMock(f.guild), [], 1, { id: 'admin' }), /изменены другим/)
	assert.equal(Object.keys(f.store.capturePresets).length, 1)
	await f.service.save(asMock(f.guild), [], 2, { id: 'admin' })
	assert.deepEqual(f.deleted, [preset.command, 'тренировка'])
	assert.ok(f.remote.has('capt'))
})

test('preset command opens one time field; submission uses saved channel/target/count and rechecks access', async () => {
	const f = await fixture(); sent.length = 0
	await f.service.save(asMock(f.guild), [preset], 0, { id: 'admin' })
	const command = f.client.commands.get(preset.command)
	assert.ok(command && 'data' in command)
	await command.execute(asMock(f.interaction))
	assert.equal(f.modals[0].toJSON().components.length, 1)
	await f.service.submit(asMock(f.interaction))
	assert.deepEqual(sent[0].slice(2), ['Тренировка', 15, true, 'channel'])
	assert.equal(sent[0][1], `<t:${Date.UTC(2026, 10, 12, 15, 30) / 1000}:t>`)
	f.roles.clear()
	await command.execute(asMock(f.interaction))
	await f.service.submit(asMock(f.interaction))
	assert.equal(sent.length, 1)
	assert.equal(f.modals.length, 1)
	assert.equal(f.replies.at(-1)?.flags, MessageFlags.Ephemeral)
	f.setAdmin()
	f.interaction.fields.getTextInputValue = () => '31.02.2026 25:90'
	await f.service.submit(asMock(f.interaction)); assert.equal(sent.length, 1)
	await f.service.save(asMock(f.guild), [], 1, { id: 'admin' })
	await f.service.submit(asMock(f.interaction)); assert.equal(sent.length, 1)
	assert.match(f.replies.at(-1)!.content, /удалена/)
})

test('preset validation rejects duplicates, existing commands, invalid roles/channels and invalid counts', async () => {
	const f = await fixture()
	for (const change of [{ maxMain: 0 }, { maxMain: 1.5 }, { maxMain: 2147483648 }, { command: 'capt' }, { command: 'Bad command' }, { accessRoleId: 'unknown' }, { channelId: 'missing' }, { target: '' }]) {
		assert.throws(() => validatePresets([{ ...preset, ...change }], asMock(f.guild)))
	}
	assert.throws(() => validatePresets([preset, preset], asMock(f.guild)))
	f.client.commands.set(preset.command, asMock({}))
	await assert.rejects(f.service.save(asMock(f.guild), [preset], 0, { id: 'admin' }), /уже существует/)
	assert.deepEqual(f.store.capturePresets, {})
})
