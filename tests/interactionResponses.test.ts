import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, MessageFlags, type Client, type ButtonInteraction } from 'discord.js'
import type { Pool } from 'pg'
import { store } from '../src/dashboard/store'
import { createFamilyWars } from '../src/services/familyWars'

// Loading the dispatcher must never open a real database connection in these tests.
const databasePath = require.resolve('../src/services/database')
const previousDatabase = require.cache[databasePath]
require.cache[databasePath] = { exports: { query() { throw new Error('Unexpected database request') } } } as NodeModule
const registerInteractions = require('../src/events/interactionCreate') as typeof import('../src/events/interactionCreate')
if (previousDatabase) require.cache[databasePath] = previousDatabase
else delete require.cache[databasePath]

function fixture(customId: string, services: Record<string, unknown> = {}, kind = 'button') {
	const responses: { method: string; payload: any }[] = []
	const interaction = {
		id: 'interaction', customId, createdTimestamp: Date.now(), deferred: false, replied: false,
		guild: { id: 'guild' }, member: { displayName: 'Tony | 123' }, message: { content: '' },
		isRepliable: () => true, inCachedGuild: () => true,
		isChatInputCommand: () => false, isUserContextMenuCommand: () => false,
		isButton: () => kind === 'button', isModalSubmit: () => false,
		isStringSelectMenu: () => kind === 'select', isUserSelectMenu: () => false,
		async reply(payload: unknown) { assert.equal(this.replied || this.deferred, false); this.replied = true; responses.push({ method: 'reply', payload }) },
		async deferReply(payload: unknown) { assert.equal(this.replied || this.deferred, false); this.deferred = true; responses.push({ method: 'deferReply', payload }) },
		async editReply(payload: unknown) { assert.equal(this.deferred || this.replied, true); responses.push({ method: 'editReply', payload }) },
		async followUp(payload: unknown) { responses.push({ method: 'followUp', payload }) },
		async showModal(payload: unknown) { assert.equal(this.replied || this.deferred, false); this.replied = true; responses.push({ method: 'showModal', payload }) }
	}
	let listener!: (value: unknown) => Promise<unknown>
	registerInteractions({ ...services, on(_event: string, callback: typeof listener) { listener = callback } } as unknown as Client)
	return { interaction, responses, dispatch: () => listener(interaction) }
}

test('unknown buttons with and without underscores receive an ephemeral stale-action reply', async () => {
	for (const id of ['old_button', 'old']) {
		const f = fixture(id)
		await f.dispatch()
		assert.equal(f.responses.length, 1)
		assert.equal(f.responses[0].method, 'reply')
		assert.equal(f.responses[0].payload.flags, MessageFlags.Ephemeral)
		assert.match(f.responses[0].payload.content, /устарело/)
	}
})

test('service rejections are caught and deferred replies are completed', async t => {
	const errors: unknown[][] = []
	t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args) })
	for (const [service, id] of [['familyWars', 'war_join_RU8_1'], ['familyMembership', 'family_cleanup_open_roles_0'], ['roleCurators', 'role_curator_invalid']]) {
		for (const deferred of [false, true]) {
			const f = fixture(id, { [service]: { async handle(interaction: typeof f.interaction) {
				if (deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral })
				throw new Error('Service failed')
			} } })
			await f.dispatch()
			assert.equal(f.responses.at(-1)?.method, deferred ? 'editReply' : 'reply')
			assert.match(f.responses.at(-1)?.payload.content, /Не удалось выполнить/)
		}
	}
	assert.equal(errors.length, 6)
	assert.equal((errors[0][1] as { customId: string }).customId, 'war_join_RU8_1')
})

test('opening an application form remains the initial response', async () => {
	const f = fixture('open_invite_modal')
	await f.dispatch()
	assert.deepEqual(f.responses.map(response => response.method), ['showModal'])
})

test('failed capture acknowledgement is logged once and never starts capture processing', async t => {
	const errors: unknown[][] = []
	t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args) })
	const f = fixture('capt_join')
	Object.assign(f.interaction, { async deferUpdate() { throw Object.assign(new Error('Unknown interaction'), { code: 10062 }) } })
	await f.dispatch()
	assert.deepEqual(f.responses, [])
	assert.equal(errors.length, 1)
	assert.equal(errors[0][0], '[Interaction]')
	assert.equal(typeof (errors[0][1] as { receivedAgeMs: number }).receivedAgeMs, 'number')
})

test('expired unacknowledged actions do not attempt another initial reply', async t => {
	t.mock.method(console, 'error', () => {})
	const f = fixture('war_join_RU8_1', { familyWars: { async handle() { throw new Error('Network failure') } } })
	f.interaction.createdTimestamp = Date.now() - 4000
	await f.dispatch()
	assert.deepEqual(f.responses, [])
})

test('retired additional-role menus receive a stale-action reply', async () => {
	const f = fixture('invite_select_additional_123', {}, 'select')
	await f.dispatch()
	assert.equal(f.responses.length, 1)
	assert.equal(f.responses[0].payload.flags, MessageFlags.Ephemeral)
	assert.match(f.responses[0].payload.content, /устарело/)
})

test('retired list buttons and menus cannot assign roles', async () => {
	for (const kind of ['button', 'select']) {
		const f = fixture('mcl_add_12345678-1234-1234-1234-123456789012', {}, kind)
		await f.dispatch()
		assert.match(f.responses[0].payload.content, /Списки отключены/)
		assert.equal(f.responses[0].payload.flags, MessageFlags.Ephemeral)
	}
})

test('archive search acknowledges before slow Discord requests and then completes the reply', async () => {
	const f = fixture('archive_find')
	let release!: () => void
	const waiting = new Promise<void>(resolve => { release = resolve })
	const thread = { id: 'archive', name: 'archive tony 123', parentId: store.getSetting('PARENT_CHANNEL_ID'), isThread: () => true }
	Object.assign(f.interaction.guild, { channels: {
		cache: new Collection(),
		async fetch() {
			assert.equal(f.interaction.deferred, true)
			await waiting
			return { threads: { async fetchActive() { return { threads: new Collection([['archive', thread]]) } } } }
		}
	} })
	const pending = f.dispatch()
	await new Promise(resolve => setImmediate(resolve))
	assert.deepEqual(f.responses.map(response => response.method), ['deferReply'])
	assert.equal(f.responses[0].payload.flags, MessageFlags.Ephemeral)
	release()
	await pending
	assert.equal(f.responses[1].payload.content, 'Ваш архив - <#archive>')
})

test('stale Family Wars buttons reply without accessing the database', async () => {
	const wars = createFamilyWars({ client: {} as Client, pool: {} as Pool, store, env: { GUILD_ID: 'guild' } })
	for (const id of ['war_old', 'war_join_RU8_1']) {
		const f = fixture(id)
		f.interaction.guild = { id: 'other-guild' }
		await wars.handle(f.interaction as unknown as ButtonInteraction<'cached'>)
		assert.equal(f.responses[0].method, 'reply')
		assert.equal(f.responses[0].payload.flags, MessageFlags.Ephemeral)
	}
})

test('archive search returns an explicit response when Discord stops responding', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	t.mock.method(console, 'error', () => {})
	const f = fixture('archive_find')
	Object.assign(f.interaction.guild, { channels: { cache: new Collection(), fetch: () => new Promise(() => {}) } })
	const pending = f.dispatch()
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(f.responses[0].method, 'deferReply')
	t.mock.timers.tick(20000)
	await pending
	assert.equal(f.responses.at(-1)?.method, 'editReply')
	assert.match(f.responses.at(-1)?.payload.content, /Discord слишком долго/)
})
