const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { createMajesticSync } = require('../src/services/majesticSync')
const { rankRoles, buildPreview } = require('../src/features/majestic/syncPreview')
const { adminPrefix } = require('../src/utils/adminPrefix')

function fixture(overrides = {}) {
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
	const store = { roleIds: () => [], getSetting: () => true, audit: async (...args) => { audits.push(args) } }
	const options = { pool, store, env: {}, now: () => clock, readFamily: async () => ({ total: family.length, items: family }),
		logger: { error() {} }, ...overrides }
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

test('applying each admin rank preserves an existing Tier and unrelated roles', async () => {
	for (const rank of ['Dep', 'High', 'Recruit']) {
		const f = fixture()
		f.setFamily([{ id: 231542, login: 'Maya Well', rankName: rank, rankId: 1 }])
		f.member.roles.cache.set(rankRoles[rank], {}).set(rankRoles['Tier 1'], {})
		const preview = await f.preview()
		await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
		await f.sync.wait(f.guild)
		assert.deepEqual(f.edits[0].roles.sort(), ['unrelated-role', rankRoles[rank], rankRoles['Tier 1']].sort())
		assert.equal((await f.preview()).rows[0].status, 'unchanged')
	}
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
	assert.equal(await f.sync.autoNicknames(f.guild), null)
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

test('apply diagnostics identify failing stages and redact secrets without exposing them in state', async () => {
	for (const stage of ['discord.roles.fetch', 'discord.members.fetch', 'database.save', 'audit: majestic.member.request', 'discord.member.edit:222222222222222222']) {
		const logs = []
		const f = fixture({ logger: { error: (...args) => logs.push(args) }, env: { MAJESTIC_SESSION_ID: 'test-session-secret', TOKEN: 'test-bot-secret' } })
		const preview = await f.preview()
		const error = Object.assign(new Error('Failure test-session-secret test-bot-secret https://example.com/private sessionId=unknown-secret'), { code: 'TEST_FAILURE', status: 503,
			requestBody: { token: 'request-body-secret' }, response: { secret: 'response-secret' } })
		const fail = async () => { throw error }
		if (stage === 'discord.roles.fetch') f.guild.roles.fetch = fail
		if (stage === 'discord.members.fetch') f.guild.members.fetch = fail
		if (stage === 'database.save') {
			const query = f.options.pool.query
			let writes = 0
			f.options.pool.query = async (...args) => {
				if (args[0].startsWith('INSERT INTO majestic_sync_state') && ++writes === 2) throw error
				return query(...args)
			}
		}
		if (stage.startsWith('audit:')) {
			const audit = f.options.store.audit
			f.options.store.audit = async (...args) => {
				if (args[1] === 'majestic.member.request') throw error
				return audit(...args)
			}
		}
		if (stage.startsWith('discord.member.edit:')) f.member.edit = fail
		await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
		await f.sync.wait(f.guild)
		assert.ok(logs.some(([, detail]) => detail.stage === stage && detail.code === 'TEST_FAILURE' && detail.status === '503'), stage)
		const output = JSON.stringify(logs)
		for (const secret of ['test-session-secret', 'test-bot-secret', 'unknown-secret', 'request-body-secret', 'response-secret', 'example.com/private']) assert.ok(!output.includes(secret), secret)
		const state = await f.sync.state(f.guild)
		assert.equal(state.run.status, 'failed')
		assert.ok(!JSON.stringify(state).includes('test-session-secret'))
		assert.equal(f.edits.length, 0)
	}
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

test('automatic nickname sync preserves prefix, suffix and all roles even when game rank differs', async () => {
	const f = fixture()
	f.member.nickname = '[𝐃𝐞𝐩] Old | 231542 / afk'
	f.member.roles.cache.set(rankRoles.Dep, {}).set(rankRoles['Tier 1'], {})
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'High', rankId: 1 }])
	const beforeRoles = [...f.member.roles.cache.keys()]
	await f.preview()
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits[0].nick, '[𝐃𝐞𝐩] Maya | 231542 / afk')
	assert.equal(Object.hasOwn(f.edits[0], 'roles'), false)
	assert.deepEqual([...f.member.roles.cache.keys()], beforeRoles)
	const state = await f.sync.state(f.guild)
	assert.equal(state.run.kind, 'nicknames')
	assert.equal(state.run.results[0].status, 'applied')
	assert.equal(state.preview.invalidated, true)
	assert.ok(f.audits.some(entry => entry[1] === 'majestic.nickname.result'))
})

test('automatic sync does nothing for unchanged nicknames and does not invalidate a role-only preview', async () => {
	const f = fixture(); f.member.nickname = 'Maya | 231542'
	await f.preview()
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).preview.invalidated, undefined)
})

test('automatic nickname sync skips duplicate statics, excluded users and absent characters', async () => {
	const f = fixture()
	f.members.set('other', { ...f.member, id: 'other' })
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.summary.conflict, 2)
	f.members.delete('other')
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, excluded: true })
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.summary.excluded, 1)
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, reset: true })
	f.setFamily([{ id: 9, login: 'Other Person', rankName: 'Main', rankId: 1 }])
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
})

test('automatic nickname sync is independent of rank-role conflicts and requires only nickname permissions', async () => {
	const f = fixture()
	f.member.roles.cache.set(rankRoles['Tier 1'], {}).set(rankRoles['Tier 2'], {})
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'Unknown Rank', rankId: 1 }])
	const { PermissionFlagsBits } = require('discord.js')
	f.guild.members.me.permissions.has = permission => permission === PermissionFlagsBits.ManageNicknames
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits[0].nick, 'Maya | 231542 / afk')
	assert.equal(Object.hasOwn(f.edits[0], 'roles'), false)
})

test('disabled auto sync and incomplete family responses do not edit Discord', async () => {
	const f = fixture()
	f.options.store.getSetting = () => false
	assert.equal(await f.sync.autoNicknames(f.guild), null)
	assert.equal(f.edits.length, 0)
	f.options.store.getSetting = () => true
	f.setFamily([])
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.status, 'failed')
})

test('automatic sync rechecks nickname and roles immediately before editing', async () => {
	const f = fixture()
	const fetch = f.guild.members.fetch
	f.guild.members.fetch = async options => {
		if (options?.user) f.member.nickname = 'Manual | 231542'
		return fetch(options)
	}
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.results[0].status, 'skipped')
})
