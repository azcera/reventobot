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
