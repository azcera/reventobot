import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChannelType, Collection, MessageFlags, type ButtonInteraction } from 'discord.js'
import { store, settingDefinitions } from '../src/dashboard/store'

const queries: { sql: string; values: unknown[] }[] = []
let applicationRows: Record<string, unknown>[] = [{ channel_id: 'application-channel', full_name: 'Tony | 123', age: 20, about_and_expectations: 'Test', previous_experience: 'Test' }]
let databaseError: Error | null = null
let rejectRows: Record<string, unknown>[] = []
const databasePath = require.resolve('../src/services/database')
const previousDatabase = require.cache[databasePath]
require.cache[databasePath] = { exports: {
	async query(sql: string, values: unknown[]) {
		queries.push({ sql, values })
		if (databaseError) throw databaseError
		if (sql.includes('FROM guild_member_identities')) return { rows: [{ discord_id: 'candidate', archive_thread_id: 'archive', game_static: '123' }] }
		if (sql.includes("status = 'rejected', guild_id")) return { rows: rejectRows }
		if (sql.startsWith('INSERT') || sql.includes('RETURNING user_id') || sql.startsWith('SELECT user_id')) return { rows: [{ user_id: 'candidate' }] }
		return { rows: applicationRows }
	}
} } as NodeModule
const { handleModerationButton } = require('../src/features/invite/inviteModeration') as typeof import('../src/features/invite/inviteModeration')
const submitRejectModal = require('../src/features/invite/inviteModalHandler') as typeof import('../src/features/invite/inviteModalHandler')
if (previousDatabase) require.cache[databasePath] = previousDatabase
else delete require.cache[databasePath]

test('accepted applications close five seconds after confirmation without additional-role menus', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const originalGetSetting = store.getSetting.bind(store)
	t.mock.method(store, 'getSetting', (key: string) => {
		if (key === 'FAMILY_ADDITIONAL_ROLES') throw new Error('Retired setting must not be read')
		if (key === 'MAIN_ROLE_ID') return 'main-role'
		if (key === 'PARENT_CHANNEL_ID') return 'archive-parent'
		return originalGetSetting(key)
	})
	assert.equal(Object.hasOwn(settingDefinitions, 'FAMILY_ADDITIONAL_ROLES'), false)
	for (const memberPresent of [true, false]) {
		queries.length = 0
		const roles: string[] = []
		const responses: any[] = []
		let deleted = false
		let resolveConfirmation!: () => void
		const confirmation = new Promise<void>(resolve => { resolveConfirmation = resolve })
		const interaction = {
			guildId: 'guild', channelId: 'application-channel', message: { async edit() {} },
			customId: 'invite_accept_candidate', user: { id: 'moderator' },
			member: { roles: { cache: new Collection() }, permissions: { has: () => true } },
			guild: {
				id: 'guild', name: 'Test', channels: { async fetch() { return { delete: async () => { deleted = true } } }, cache: new Collection<string, unknown>([
					['archive-parent', { type: ChannelType.GuildText }],
					['archive', { id: 'archive', name: 'archive tony 123', parentId: 'archive-parent', archived: true, isThread: () => true }]
				]) },
				members: { async fetch() { return memberPresent ? { id: 'candidate', displayName: 'Tony | 123', roles: { async add(id: string) { roles.push(id) } } } : null } }
			},
			client: { users: { async fetch() { return null } } },
			channel: { async delete() { deleted = true } },
			async deferReply() {},
			async followUp(payload: unknown) { responses.push(payload); await confirmation; return { deletable: false } }
		}
		const pending = handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(responses.length, 1)
		assert.match(responses[0].content, /одобрена.*5 секунд/)
		assert.equal(responses[0].components, undefined)
		assert.equal(responses[0].flags, MessageFlags.Ephemeral)
		t.mock.timers.tick(10000)
		assert.equal(deleted, false)
		resolveConfirmation()
		await pending
		t.mock.timers.tick(4999)
		assert.equal(deleted, false)
		t.mock.timers.tick(1)
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(deleted, true)
		assert.deepEqual(roles, memberPresent ? ['main-role'] : [])
		assert.match(queries.at(-1)!.sql, /DELETE FROM family_applications WHERE guild_id/)
		assert.deepEqual(queries.at(-1)!.values, ['guild', 'application-channel'])
	}
})

test('missing, stale, concurrent and failed applications are handled safely', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const { buildContainer } = await import('../src/features/invite/inviteUtils')
	const source = (await buildContainer('candidate', 'Original name', 20, 'Original answers', 'History', 'отправления')).toJSON()
	const previousRows = applicationRows
	applicationRows = []
	t.after(() => { applicationRows = previousRows })
	t.mock.method(console, 'warn', () => {})
	const edits: any[] = []
	const responses: any[] = []
	let roleCalls = 0
	let deleted = false
	const interaction = {
		customId: 'invite_accept_candidate', guildId: 'guild', channelId: 'application-channel',
		user: { id: 'moderator' },
		member: { roles: { cache: new Collection() }, permissions: { has: () => true } },
		message: {
			author: { id: 'bot' }, channelId: 'application-channel', webhookId: null,
			components: [{ toJSON: () => source }],
			async edit(payload: unknown) { edits.push(payload) }
		},
		guild: { id: 'guild', name: 'Test', channels: { async fetch() { return { delete: async () => { deleted = true } } }, cache: new Collection() }, members: { async fetch() {
			roleCalls++; return null
		} } },
		client: { user: { id: 'bot' }, users: { async fetch() { return null } } },
		channel: { async delete() { deleted = true } },
		deferred: true,
		async deferReply() {},
		async editReply(payload: unknown) { responses.push(payload) },
		async followUp(payload: unknown) { responses.push(payload); return { deletable: false } }
	}
	await handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
	assert.equal(roleCalls, 1)
	assert.match(responses[0].content, /одобрена/)
	assert.match(JSON.stringify(edits[0]), /Original answers/)
	assert.match(JSON.stringify(edits[0]), /Запись в БД отсутствовала/)
	assert.doesNotMatch(JSON.stringify(edits[0]), /invite_accept_/)
	t.mock.timers.tick(5000)
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(deleted, true)

	// A foreign message, an already processed message, or another application's channel cannot be accepted.
	for (const scenario of ['foreign', 'processed', 'other-channel']) {
		roleCalls = 0
		responses.length = 0
		queries.length = 0
		interaction.message.author.id = scenario === 'foreign' ? 'foreign-user' : 'bot'
		interaction.message.components = [{ toJSON: () => scenario === 'processed' ? edits[0].components[0] : source }]
		applicationRows = scenario === 'other-channel' ? [{ ...previousRows[0], channel_id: 'other' }] : []
		await handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
		assert.equal(roleCalls, 0, scenario)
		assert.equal(queries.length, 1, scenario)
		assert.match(responses[0].content, /❌/, scenario)
	}

	applicationRows = previousRows
	interaction.message.components = [{ toJSON: () => source }]
	responses.length = 0
	let release!: () => void
	const gate = new Promise<void>(resolve => { release = resolve })
	const fetchMock = t.mock.method(interaction.guild.members, 'fetch', async () => {
		await gate
		return null
	})
	const pending = handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
	await new Promise(resolve => setImmediate(resolve))
	await handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
	assert.equal(responses.length, 1)
	assert.match(responses[0].content, /уже обрабатывается/)
	release()
	await pending
	fetchMock.mock.restore()
	t.mock.timers.tick(5000)
	await new Promise(resolve => setImmediate(resolve))

	t.mock.method(console, 'error', () => {})
	responses.length = 0
	queries.length = 0
	roleCalls = 0
	databaseError = new Error('Database unavailable')
	try {
		await handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
		assert.match(responses[0].content, /Не удалось загрузить/)
		assert.equal(roleCalls, 0)
		assert.equal(queries.length, 1)
	} finally {
		databaseError = null
	}

	// The failed request must release its lock, and a role failure must not close the application.
	responses.length = 0
	queries.length = 0
	deleted = false
	const editCount = edits.length
	t.mock.method(interaction.guild.members, 'fetch', async () => ({
		roles: { async add() { throw new Error('Missing permissions') } }
	}) as any)
	await handleModerationButton(interaction as unknown as ButtonInteraction<'cached'>)
	assert.match(responses[0].content, /Ошибка|ошибка/)
	assert.equal(queries.length, 3)
	assert.equal(edits.length, editCount)
	t.mock.timers.tick(5000)
	assert.equal(deleted, false)
})

test('reject submit checks fresh rights, scopes the state transition and reports DB failure', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	t.mock.method(console, 'error', () => {})
	const replies: string[] = []
	let admin = false
	const interaction = {
		customId: 'invite_modal_reject_candidate_guild_application-channel',
		user: { id: 'moderator' },
		guildId: 'guild', channelId: 'application-channel',
		guild: { name: 'Test', members: { async fetch(options: unknown) {
			assert.deepEqual(options, { user: 'moderator', force: true, cache: false })
			return { permissions: { has: () => admin }, roles: { cache: new Collection() } }
		} } },
		client: { users: { async fetch() { return null } } },
		fields: { getTextInputValue: () => 'fixture' },
		async deferReply() {},
		async editReply(text: string) { replies.push(text) }
	}
	const submit = () => submitRejectModal(interaction as unknown as import('discord.js').ModalSubmitInteraction<'cached'>)
	queries.length = 0
	await submit()
	assert.match(replies.pop()!, /нет прав/)
	assert.equal(queries.length, 0)

	admin = true
	interaction.channelId = 'other-channel'
	await submit()
	assert.match(replies.pop()!, /устаревшей/)
	assert.equal(queries.length, 0)
	interaction.channelId = 'application-channel'
	await submit()
	assert.match(replies.pop()!, /обработана или недоступна/)
	assert.match(queries.at(-1)!.sql, /AND COALESCE\(status, 'pending'\) = 'pending' RETURNING/)
	assert.deepEqual(queries.at(-1)!.values, ['candidate', 'application-channel', 'guild'])

	databaseError = new Error('database down')
	try {
		await submit()
		assert.match(replies.pop()!, /Не удалось отклонить/)
	} finally { databaseError = null }
})
