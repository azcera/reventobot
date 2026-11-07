const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { createMajesticSync } = require('../src/services/majesticSync')
const { rankRoles, buildPreview } = require('../src/features/majestic/syncPreview')
const { adminPrefix } = require('../src/utils/adminPrefix')

function fixture() {
	let saved
	let clock = 100000
	let family = [{ id: 231542, login: 'Maya Well', rankName: 'Main', rankId: 1 }]
	const edits = [], audits = []
	const actor = { id: '333333333333333333', name: 'Admin' }
	const roles = new Collection(Object.values(rankRoles).map(id => [id, { id, editable: true }]))
	const member = {
		id: '222222222222222222', nickname: 'Old | 231542 / afk', user: { bot: false }, manageable: true,
		roles: { cache: new Collection([['unrelated-role', {}], [rankRoles.Test, {}]]) },
		async edit(payload) {
			edits.push(payload)
			if (payload.nick) this.nickname = payload.nick
			if (payload.roles) this.roles.cache = new Collection(payload.roles.map(id => [id, {}]))
		}
	}
	const members = new Collection([[member.id, member]])
	const guild = { id: '111111111111111111', roles: { cache: roles, fetch: async () => roles },
		members: { me: { permissions: { has: () => true } }, fetch: async options => options?.user ? members.get(options.user) : members } }
	const pool = { async query(sql, params) {
		if (sql.startsWith('SELECT value')) return { rows: saved ? [{ value: structuredClone(saved) }] : [] }
		if (sql.startsWith('INSERT INTO majestic_sync_state')) saved = JSON.parse(params[1])
		return { rows: [] }
	} }
	const store = { roleIds: () => [], audit: async (...args) => { audits.push(args) } }
	const options = { pool, store, env: {}, now: () => clock, readFamily: async () => ({ total: family.length, items: family }) }
	const sync = createMajesticSync(options)
	async function preview() { await sync.preview(guild, actor); await sync.wait(guild); return (await sync.state(guild)).preview }
	return { sync, options, actor, guild, member, members, edits, audits, preview,
		setFamily(value) { family = value }, advance() { clock += 16 * 60 * 1000 }, saved: () => saved }
}

test('apply edits only selected members, preserves unrelated roles and persists result without secrets', async () => {
	const f = fixture()
	const preview = await f.preview()
	assert.equal(f.edits.length, 0)
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
	await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 1)
	assert.equal(f.edits[0].nick, 'Maya | 231542 / afk')
	assert.deepEqual(f.edits[0].roles.sort(), ['unrelated-role', rankRoles.Main].sort())
	const state = await f.sync.state(f.guild)
	assert.equal(state.run.results[0].status, 'applied')
	assert.equal(state.run.completed, 1)
	assert.equal(f.saved().preview.invalidated, true)
	assert.ok(f.audits.some(entry => entry[1] === 'majestic.member.request'))
	await assert.rejects(f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }), /устарел/)
	assert.equal((await f.preview()).rows[0].status, 'unchanged')
})

test('changed Discord state or game rank aborts an approved plan before writes', async () => {
	for (const mutate of [f => { f.member.nickname = 'Changed | 231542' }, f => f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'Dep', rankId: 1 }])]) {
		const f = fixture(); const preview = await f.preview(); mutate(f)
		await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }); await f.sync.wait(f.guild)
		assert.equal((await f.sync.state(f.guild)).run.status, 'failed')
		assert.equal(f.edits.length, 0)
	}
})

test('expired previews and non-change rows cannot be applied', async () => {
	const f = fixture(); const preview = await f.preview(); f.advance()
	await assert.rejects(f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }), /устарел/)
	const current = await f.preview()
	await assert.rejects(f.sync.apply(f.guild, f.actor, { previewId: current.id, discordIds: ['unknown'] }), /без конфликтов/)
	await assert.rejects(f.sync.apply(f.guild, f.actor, { previewId: current.id, discordIds: [] }), /Выберите/)
})

test('resolutions persist, invalidate preview and can be reset', async () => {
	const f = fixture(); await f.preview()
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, static: '231542', excluded: true })
	const restored = createMajesticSync(f.options)
	assert.equal((await restored.state(f.guild)).decisions[f.member.id].excluded, true)
	assert.equal((await f.sync.state(f.guild)).preview.invalidated, true)
	assert.equal((await f.preview()).rows[0].status, 'excluded')
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, reset: true })
	assert.equal((await f.preview()).rows[0].status, 'change')
	await assert.rejects(f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, tierRoleId: rankRoles['Tier 1'] }), /уже выданную/)
})

test('saved Tier choice fixes multiple tiers while keeping exactly one', async () => {
	const f = fixture()
	f.member.roles.cache.set(rankRoles['Tier 1'], {}).set(rankRoles['Tier 2'], {})
	assert.equal((await f.preview()).rows[0].status, 'conflict')
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, tierRoleId: rankRoles['Tier 2'] })
	const preview = await f.preview()
	assert.equal(preview.rows[0].status, 'change')
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }); await f.sync.wait(f.guild)
	assert.deepEqual(f.edits[0].roles.sort(), ['unrelated-role', rankRoles['Tier 2']].sort())
})

test('excluding duplicate account leaves one unambiguous binding', async () => {
	const f = fixture(); const clone = { ...f.member, id: '444444444444444444' }; f.members.set(clone.id, clone)
	assert.ok((await f.preview()).rows.every(row => row.status === 'conflict'))
	await f.sync.resolve(f.guild, f.actor, { discordId: clone.id, excluded: true })
	const rows = (await f.preview()).rows
	assert.equal(rows[0].status, 'change'); assert.equal(rows[1].status, 'excluded')
})

test('concurrent runs are rejected and stop prevents the next Discord mutation', async () => {
	const f = fixture(); const preview = await f.preview()
	let release, entered
	const gate = new Promise(resolve => { release = resolve })
	const started = new Promise(resolve => { entered = resolve })
	const fetch = f.guild.roles.fetch
	f.guild.roles.fetch = async () => { entered(); await gate; return fetch() }
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
	await started
	await assert.rejects(f.sync.preview(f.guild, f.actor), /уже выполняется/)
	await f.sync.stop(f.guild, f.actor); release(); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.status, 'stopped')
})

test('Discord failure stops the run and does not expose response details', async () => {
	const f = fixture(); const preview = await f.preview()
	f.member.edit = async () => { throw new Error('private token and response') }
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }); await f.sync.wait(f.guild)
	const state = await f.sync.state(f.guild)
	assert.equal(state.run.status, 'failed')
	assert.equal(state.run.results[0].status, 'failed')
	assert.ok(!JSON.stringify(state).includes('private token'))
})

test('restart marks unfinished jobs interrupted and prevents replay', async () => {
	const f = fixture(); const preview = await f.preview()
	const saved = f.saved(); saved.run.status = 'running'
	await f.options.pool.query('INSERT INTO majestic_sync_state', [f.guild.id, JSON.stringify(saved)])
	const restored = createMajesticSync(f.options)
	assert.equal((await restored.state(f.guild)).run.status, 'interrupted')
	await assert.rejects(restored.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }), /устарел/)
})

test('preview and existing role handler select the same final admin prefix', () => {
	const admins = [rankRoles.Dep, rankRoles.High, rankRoles.Recruit]
	const row = buildPreview([{ id: 1, login: 'Maya Well', rankName: 'Dep' }], [{ id: 'user', nickname: '[𝐇𝐢𝐠𝐡] Old | 1 / afk', roleIds: [rankRoles.High] }], { adminRoleIds: admins })[0]
	assert.equal(row.nickname, '[𝐃𝐞𝐩] Maya | 1 / afk')
	assert.equal(adminPrefix([rankRoles.Dep], admins), '[𝐃𝐞𝐩] ')
	assert.equal(adminPrefix([rankRoles.High, rankRoles.Dep], admins), '[𝐃𝐞𝐩] ')
})
