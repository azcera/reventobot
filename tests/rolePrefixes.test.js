const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection, Events } = require('discord.js')
const { createFixture } = require('./helpers/dashboardFixture')
const { store, createStore } = require('../src/dashboard/store')
const { adminPrefix } = require('../src/utils/adminPrefix')
const { buildPreview, rankRoles } = require('../src/features/majestic/syncPreview')

test('existing prefixes are defaults; custom mappings persist, select by priority and can be removed', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const ids = ['555555555555555555', '666666666666666666', '777777777777777777', '888888888888888888']
	for (const id of ids) f.guild.roles.cache.set(id, { id, name: id, guild: f.guild })
	await store.save('settings', { ADMIN_ROLES: ids.slice(0, 3).join(',') }, 0, 'admin')
	assert.deepEqual(store.getSetting('ROLE_PREFIXES').map(entry => entry.prefix), ['[𝐃𝐞𝐩]', '[𝐇𝐢𝐠𝐡]', '[𝐑𝐞𝐜]'])
	assert.equal(adminPrefix([ids[1], ids[0]], ids), '[𝐃𝐞𝐩] ')
	const entries = store.getSetting('ROLE_PREFIXES').concat({ roleId: ids[3], prefix: '[New]' })
	entries[0].prefix = '[Boss]'
	const response = await f.request('/api/settings', { body: { revision: 1, values: { ROLE_PREFIXES: entries } } })
	assert.equal(response.status, 200)
	assert.deepEqual((await response.json()).settings.find(field => field.key === 'ROLE_PREFIXES').value, entries)
	const restarted = createStore(); await restarted.init(f.pool)
	assert.deepEqual(restarted.getSetting('ROLE_PREFIXES'), entries)
	assert.equal(adminPrefix([ids[3], ids[0]], ids, entries), '[Boss] ')
	assert.equal(adminPrefix([ids[3]], ids, entries), '[New] ')
	assert.equal(adminPrefix([ids[0]], ids, []), '')

	let handler
	require('../src/events/guildMemberUpdate')({ on(event, callback) { assert.equal(event, Events.GuildMemberUpdate); handler = callback } })
	const edits = []
	const member = roleIds => ({ displayName: 'Maya', roles: { cache: new Collection(roleIds.map(id => [id, { id }])) }, manageable: true, setNickname: async nickname => edits.push(nickname) })
	await handler(member([]), member([ids[3]]))
	const before = member([ids[3]]); before.displayName = '[New] Maya'
	const after = member([]); after.displayName = '[New] Maya'
	await handler(before, after)
	assert.deepEqual(edits, ['[New] Maya', 'Maya'])

	const row = buildPreview([{ id: 1, login: 'Maya Well', rankName: 'Dep' }], [{ id: 'user', nickname: 'Old | 1', roleIds: [] }], {
		rolePrefixes: [{ roleId: rankRoles.Dep, prefix: '[Boss]' }]
	})[0]
	assert.equal(row.nickname, '[Boss] Maya | 1')
	await store.save('settings', { ROLE_PREFIXES: [] }, 2, 'admin')
	assert.deepEqual(store.getSetting('ROLE_PREFIXES'), [])
})

test('prefix settings reject unknown roles, duplicate roles and invalid text', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const roleId = '555555555555555555'
	f.guild.roles.cache.set(roleId, { id: roleId, guild: f.guild })
	for (const entries of ['bad', [null], [{ roleId: f.channelId, prefix: '[Test]' }], [{ roleId, prefix: '[Test]' }, { roleId, prefix: '[Other]' }],
		[{ roleId, prefix: 'Test' }], [{ roleId, prefix: '[Bad\ntext]' }], [{ roleId, prefix: '[' + 'x'.repeat(24) + ']' }]]) {
		assert.equal((await f.request('/api/settings', { body: { revision: 0, values: { ROLE_PREFIXES: entries } } })).status, 400)
	}
	assert.equal(store.revision, 0)
})

test('bulk sync uses saved prefixes and role priority, preserves names and continues after skips and errors', async t => {
	const f = await createFixture(); t.after(() => f.close())
	assert.equal((await f.request('/api/role-prefixes/sync', { body: {} })).status, 401)
	await f.login()
	const first = '555555555555555555', second = '666666666666666666'
	for (const id of [first, second]) f.guild.roles.cache.set(id, { id, guild: f.guild })
	const saved = await f.request('/api/settings', { body: { revision: 0, values: { ROLE_PREFIXES: [{ roleId: first, prefix: '[Boss]' }, { roleId: second, prefix: '[New]' }] } } })
	assert.equal(saved.status, 200)
	const edits = []
	const member = (id, displayName, roles, manageable = true, fail = false) => ({
		id, displayName, manageable, roles: { cache: new Collection(roles.map(roleId => [roleId, { id: roleId }])) },
		async setNickname(nickname) {
			if (fail) throw new Error('Discord unavailable')
			edits.push([id, nickname]); this.displayName = nickname
		}
	})
	const members = [
		member('priority', '[Old] Maya | 123 / text', [second, first]),
		member('unchanged', '[New] Alex', [second]),
		member('unrelated', '[Other] Nick', []),
		member('hierarchy', '[Old] Owner', [first], false),
		member('long', '[X] ' + 'a'.repeat(28), [first]),
		member('failed', '[Old] Sam', [first], true, true),
		member('last', 'Tony', [second])
	]
	const fetchMember = f.guild.members.fetch
	f.guild.members.fetch = async id => typeof id === 'string' || id?.user ? fetchMember(id) : new Collection(members.map(item => [item.id, item]))
	f.setAdmin(false)
	assert.equal((await f.request('/api/role-prefixes/sync', { body: {} })).status, 403)
	f.setAdmin(true)
	await f.login()
	assert.equal((await f.request('/api/role-prefixes/sync', { body: {}, headers: { 'X-CSRF-Token': 'invalid' } })).status, 403)
	const response = await f.request('/api/role-prefixes/sync', { body: {} })
	assert.equal(response.status, 200)
	assert.deepEqual(await response.json(), { updated: 2, unchanged: 1, skipped: 2, failed: 1 })
	assert.deepEqual(edits, [['priority', '[Boss] Maya | 123 / text'], ['last', '[New] Tony']])
	const retry = await f.request('/api/role-prefixes/sync', { body: {} })
	assert.deepEqual(await retry.json(), { updated: 0, unchanged: 3, skipped: 2, failed: 1 })
})

test('bulk sync prevents overlapping runs and releases its lock after a fetch error', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const fetchMember = f.guild.members.fetch
	let release, started
	const fetching = new Promise(resolve => { started = resolve })
	f.guild.members.fetch = async id => {
		if (typeof id === 'string' || id?.user) return fetchMember(id)
		started()
		return new Promise((resolve, reject) => { release = () => reject(new Error('Fetch failed')) })
	}
	const running = f.request('/api/role-prefixes/sync', { body: {} })
	await fetching
	assert.equal((await f.request('/api/role-prefixes/sync', { body: {} })).status, 409)
	release()
	assert.equal((await running).status, 502)
	f.guild.members.fetch = async id => typeof id === 'string' || id?.user ? fetchMember(id) : new Collection()
	assert.equal((await f.request('/api/role-prefixes/sync', { body: {} })).status, 200)
})
