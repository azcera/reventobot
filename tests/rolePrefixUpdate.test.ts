import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, Events, type Client, type GuildMember } from 'discord.js'
import { store } from '../src/dashboard/store'
import register = require('../src/events/guildMemberUpdate')

test('role updates replace dashboard tags when roles are added and removed', async t => {
	const prefixes = [{ roleId: 'high', prefix: 'HIGH >' }, { roleId: 'low', prefix: 'LOW ::' }]
	t.mock.method(store, 'getSetting', (key: string) => key === 'ROLE_PREFIXES' ? prefixes : '')
	t.mock.method(store, 'roleIds', () => [])
	let listener!: (oldMember: GuildMember, newMember: GuildMember) => Promise<void>
	register({ on: (event: string, handler: typeof listener) => {
		assert.equal(event, Events.GuildMemberUpdate)
		listener = handler
	} } as unknown as Client)
	const updates: string[] = []
	const member = (roleIds: string[], displayName: string, manageable = true) => ({
		partial: false, displayName, manageable,
		roles: { cache: new Collection(roleIds.map(id => [id, { id }])) },
		async setNickname(name: string) { updates.push(name) }
	} as unknown as GuildMember)
	let roles: string[] = []
	let nickname = 'Tony | 123 / inactive'
	for (const [nextRoles, expected] of [
		[['low'], 'LOW :: Tony | 123 / inactive'],
		[['low', 'high'], 'HIGH > Tony | 123 / inactive'],
		[['low'], 'LOW :: Tony | 123 / inactive'],
		[[], 'Tony | 123 / inactive']
	] as [string[], string][]) {
		await listener(member(roles, nickname), member(nextRoles, nickname))
		assert.equal(updates.at(-1), expected)
		roles = nextRoles
		nickname = expected
	}
	assert.equal(updates.length, 4)
	await listener(member(['high'], 'HIGH > Tony | 123'), member(['high', 'low'], 'HIGH > Tony | 123'))
	await listener(member([], nickname), member(['low'], nickname, false))
	await listener(member(['low'], nickname), member(['low', 'other'], nickname))
	assert.equal(updates.length, 4)
	await listener(member(['low'], '[Old] Tony | 123'), member(['high'], '[Old] Tony | 123'))
	assert.equal(updates.at(-1), 'HIGH > Tony | 123')
})
