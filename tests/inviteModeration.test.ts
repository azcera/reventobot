import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, MessageFlags, type ButtonInteraction } from 'discord.js'
import { store, settingDefinitions } from '../src/dashboard/store'

const queries: { sql: string; values: unknown[] }[] = []
const databasePath = require.resolve('../src/services/database')
const previousDatabase = require.cache[databasePath]
require.cache[databasePath] = { exports: {
	async query(sql: string, values: unknown[]) {
		queries.push({ sql, values })
		return { rows: [{ full_name: 'Test', age: 20, about_and_expectations: 'Test', previous_experience: 'Test' }] }
	}
} } as NodeModule
const { handleModerationButton } = require('../src/features/invite/inviteModeration') as typeof import('../src/features/invite/inviteModeration')
if (previousDatabase) require.cache[databasePath] = previousDatabase
else delete require.cache[databasePath]

test('accepted applications close five seconds after confirmation without additional-role menus', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const originalGetSetting = store.getSetting.bind(store)
	t.mock.method(store, 'getSetting', (key: string) => {
		if (key === 'FAMILY_ADDITIONAL_ROLES') throw new Error('Retired setting must not be read')
		if (key === 'MAIN_ROLE_ID') return 'main-role'
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
			customId: 'invite_accept_candidate', user: { id: 'moderator' },
			member: { roles: { cache: new Collection() }, permissions: { has: () => true } },
			guild: {
				name: 'Test', channels: { cache: new Collection() },
				members: { async fetch() { return memberPresent ? { roles: { async add(id: string) { roles.push(id) } } } : null } }
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
		assert.equal(deleted, true)
		assert.deepEqual(roles, memberPresent ? ['main-role'] : [])
		assert.deepEqual(queries.at(-1), { sql: 'DELETE FROM family_applications WHERE user_id = $1', values: ['candidate'] })
	}
})
