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

function bulkFixture(count = 150) {
	const f = fixture()
	f.members.clear()
	const family = []
	for (let index = 0; index < count; index++) {
		const id = String(222222222222220000n + BigInt(index))
		const staticId = 10000 + index
		family.push({ id: staticId, login: 'Maya Well', rankName: 'Main', rankId: 1 })
		f.members.set(id, { ...f.member, id, nickname: `Old | ${staticId}`,
			roles: { cache: new Collection(f.member.roles.cache) } })
	}
	f.setFamily(family)
	return f
}

test('manual and automatic sync process 150 members sequentially and persist all results', async () => {
	for (const automatic of [false, true]) {
		const f = bulkFixture()
		let active = 0, maxActive = 0
		for (const member of f.members.values()) {
			const edit = member.edit
			member.edit = async function(payload) {
				active++; maxActive = Math.max(maxActive, active)
				await Promise.resolve()
				await edit.call(this, payload)
				active--
			}
		}
		if (automatic) await f.sync.autoNicknames(f.guild)
		else {
			const preview = await f.preview()
			await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [...f.members.keys()] })
		}
		await f.sync.wait(f.guild)
		const state = await f.sync.state(f.guild)
		assert.equal(maxActive, 1)
		assert.equal(state.run.status, 'completed')
		assert.equal(state.run.completed, 150)
		assert.equal(state.run.total, 150)
		assert.equal(f.edits.length, 150)
		assert.equal(f.saved().run.results.filter(row => row.status === 'applied').length, 150)
		for (const member of f.members.values()) {
			assert.match(member.nickname, /^Maya \| \d+$/)
			assert.ok(member.roles.cache.has('unrelated-role'))
			assert.equal(member.roles.cache.has(rankRoles.Main), true)
			assert.equal(member.roles.cache.has(rankRoles.Test), false)
		}
	}
})

test('member fetch and edit errors do not interrupt remaining members in a 150-member batch', async () => {
	for (const automatic of [false, true]) {
		const f = bulkFixture()
		const ids = [...f.members.keys()]
		const preview = automatic ? null : await f.preview()
		const fetch = f.guild.members.fetch
		f.guild.members.fetch = async options => {
			if (options?.user === ids[4]) throw Object.assign(new Error('Unknown member'), { status: 404, code: 10007 })
			return fetch(options)
		}
		f.members.get(ids[9]).edit = async () => { throw Object.assign(new Error('Missing permissions'), { status: 403, code: 50013 }) }
		if (automatic) await f.sync.autoNicknames(f.guild)
		else await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: ids })
		await f.sync.wait(f.guild)
		const state = await f.sync.state(f.guild)
		assert.equal(state.run.status, 'completed_with_errors')
		assert.equal(state.run.completed, 150)
		assert.equal(state.run.results.length, 150)
		assert.equal(state.run.results.filter(row => row.status === 'failed').length, 2)
		assert.equal(state.run.results.at(-1).status, 'applied')
		assert.equal(f.edits.length, 148)
		assert.deepEqual(f.saved().run.results, state.run.results)
		assert.ok(f.audits.some(entry => entry[1] === 'majestic.member.result' && entry[2] === ids[4]))
	}
})

test('database failure stops a bulk operation before any further Discord edits', async () => {
	const f = bulkFixture()
	const preview = await f.preview()
	const query = f.options.pool.query
	f.options.pool.query = async (...args) => {
		if (f.edits.length >= 5 && args[0].startsWith('INSERT INTO majestic_sync_state')) throw new Error('database unavailable')
		return query(...args)
	}
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [...f.members.keys()] })
	await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 5)
	assert.equal((await f.sync.state(f.guild)).run.status, 'failed')
})

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

test('apply waits for the opcode 8 rate limit then fetches fresh members before editing', async () => {
	const waits = []
	const f = fixture({ sleep: async ms => { waits.push(ms); assert.equal(f.edits.length, 0) } })
	const preview = await f.preview()
	const fetch = f.guild.members.fetch
	let requests = 0
	f.guild.members.fetch = async options => {
		if (!options?.user && ++requests === 1) throw Object.assign(new Error('rate limited'), {
			name: 'GatewayRateLimitError', data: { opcode: 8, retry_after: 16.075 }
		})
		return fetch(options)
	}
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
	await f.sync.wait(f.guild)
	assert.deepEqual(waits, [16325])
	assert.equal(requests, 2)
	assert.equal(f.edits.length, 1)
	assert.equal((await f.sync.state(f.guild)).run.status, 'completed')
})

test('member fetch retries are bounded and do not retry unrelated or invalid rate limits', async () => {
	for (const [name, data, expectedRequests] of [
		['GatewayRateLimitError', { opcode: 8, retry_after: 5.149 }, 3],
		['Error', { opcode: 8, retry_after: 1 }, 1],
		['GatewayRateLimitError', { opcode: 8, retry_after: -1 }, 1],
		['GatewayRateLimitError', { opcode: 8, retry_after: 61 }, 1],
		['GatewayRateLimitError', { opcode: 8, retry_after: NaN }, 1],
		['GatewayRateLimitError', { opcode: 1, retry_after: 1 }, 1]
	]) {
		const waits = []
		const f = fixture({ sleep: async ms => waits.push(ms) })
		const preview = await f.preview()
		let requests = 0
		f.guild.members.fetch = async () => { requests++; throw Object.assign(new Error('fetch failed'), { name, data }) }
		await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
		await f.sync.wait(f.guild)
		assert.equal(requests, expectedRequests)
		assert.equal(waits.length, expectedRequests - 1)
		assert.equal(f.edits.length, 0)
		assert.equal((await f.sync.state(f.guild)).run.status, 'failed')
	}
})

test('stopping while waiting for member fetch prevents edits', async () => {
	const f = fixture({ sleep: async () => { await f.sync.stop(f.guild, f.actor) } })
	const preview = await f.preview()
	const fetch = f.guild.members.fetch
	let requests = 0
	f.guild.members.fetch = async options => {
		if (!options?.user && ++requests === 1) throw Object.assign(new Error('rate limited'), {
			name: 'GatewayRateLimitError', data: { opcode: 8, retry_after: 1 }
		})
		return fetch(options)
	}
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] })
	await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.status, 'stopped')
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

test('Discord failure is recorded without exposing response details', async () => {
	const f = fixture(); const preview = await f.preview()
	f.member.edit = async () => { throw new Error('private token and response') }
	await f.sync.apply(f.guild, f.actor, { previewId: preview.id, discordIds: [f.member.id] }); await f.sync.wait(f.guild)
	const state = await f.sync.state(f.guild)
	assert.equal(state.run.status, 'completed_with_errors')
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
		assert.equal(state.run.status, stage.startsWith('discord.member.edit:') ? 'completed_with_errors' : 'failed')
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

test('automatic sync binds static, updates nickname and rank, and preserves Tier and unrelated roles', async () => {
	const f = fixture()
	f.member.nickname = '[𝐃𝐞𝐩] Old | 231542 / afk'
	f.member.roles.cache.set(rankRoles.Dep, {}).set(rankRoles['Tier 1'], {})
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'High', rankId: 1 }])
	f.options.store.roleIds = () => [rankRoles.Dep, rankRoles.High, rankRoles.Recruit]
	await f.preview()
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits[0].nick, '[𝐇𝐢𝐠𝐡] Maya | 231542 / afk')
	assert.deepEqual([...f.member.roles.cache.keys()].sort(), ['unrelated-role', rankRoles.High, rankRoles['Tier 1']].sort())
	const state = await f.sync.state(f.guild)
	assert.equal(state.run.kind, 'sync')
	assert.equal(f.saved().decisions[f.member.id].static, '231542')
	assert.equal(state.run.results[0].status, 'applied')
	assert.equal(state.preview.invalidated, true)
	assert.ok(f.audits.some(entry => entry[1] === 'majestic.member.result'))
})

test('automatic sync applies role-only changes then leaves unchanged previews valid', async () => {
	const f = fixture(); f.member.nickname = 'Maya | 231542'
	await f.preview()
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 1)
	assert.equal((await f.sync.state(f.guild)).preview.invalidated, true)
	assert.equal(f.edits[0].nick, undefined)
	await f.preview()
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 1)
	assert.equal((await f.sync.state(f.guild)).preview.invalidated, undefined)
})

test('automatic binding persists without edits and a new member is bound on the next pass', async () => {
	const f = fixture()
	f.member.nickname = 'Maya | 231542'
	f.member.roles.cache.delete(rankRoles.Test)
	f.member.roles.cache.set(rankRoles.Main, {})
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal(f.saved().decisions[f.member.id].static, '231542')
	assert.ok(f.audits.some(entry => entry[1] === 'majestic.bind.auto'))
	const newcomer = { ...f.member, id: '444444444444444444', nickname: 'Old | 9',
		roles: { cache: new Collection([['unrelated-role', {}], [rankRoles.Test, {}]]) } }
	f.members.set(newcomer.id, newcomer)
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'Main', rankId: 1 },
		{ id: 9, login: 'New Player', rankName: 'Main', rankId: 1 }])
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.saved().decisions[newcomer.id].static, '9')
	assert.equal(newcomer.nickname, 'New | 9')
	assert.ok(newcomer.roles.cache.has(rankRoles.Main))
	assert.ok(!newcomer.roles.cache.has(rankRoles.Test))
})

test('persisted binding survives a restart and nickname changes while game name and rank stay synchronized', async () => {
	const f = fixture()
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	f.member.nickname = 'Unrecognizable nickname'
	f.setFamily([{ id: 231542, login: 'Updated Person', rankName: 'High', rankId: 1 }])
	const restored = createMajesticSync(f.options)
	await restored.autoNicknames(f.guild); await restored.wait(f.guild)
	assert.equal(f.member.nickname, 'Updated | 231542')
	assert.ok(f.member.roles.cache.has(rankRoles.High))
	assert.ok(!f.member.roles.cache.has(rankRoles.Main))
	assert.equal(f.saved().decisions[f.member.id].static, '231542')
	assert.equal(f.audits.filter(entry => entry[1] === 'majestic.bind.auto').length, 1)
})

test('automatic sync keeps manual bindings even when the nickname contains a different static', async () => {
	const f = fixture()
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'Main', rankId: 1 },
		{ id: 9, login: 'Linked Player', rankName: 'High', rankId: 1 }])
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, static: '9' })
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.member.nickname, 'Linked | 9 / afk')
	assert.equal(f.saved().decisions[f.member.id].static, '9')
	assert.ok(!f.audits.some(entry => entry[1] === 'majestic.bind.auto'))
})

test('automatic nickname sync skips duplicate statics, excluded users and absent characters', async () => {
	const f = fixture()
	f.members.set('other', { ...f.member, id: 'other' })
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.summary.conflict, 2)
	assert.deepEqual(f.saved().decisions, {})
	f.members.delete('other')
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, excluded: true })
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.summary.excluded, 1)
	assert.equal(f.saved().decisions[f.member.id].static, undefined)
	await f.sync.resolve(f.guild, f.actor, { discordId: f.member.id, reset: true })
	f.setFamily([{ id: 9, login: 'Other Person', rankName: 'Main', rankId: 1 }])
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal(f.saved().decisions[f.member.id], undefined)
})

test('automatic sync preserves rank conflicts for manual resolution and requires role permissions', async () => {
	const f = fixture()
	f.member.roles.cache.set(rankRoles['Tier 1'], {}).set(rankRoles['Tier 2'], {})
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'Unknown Rank', rankId: 1 }])
	const { PermissionFlagsBits } = require('discord.js')
	f.guild.members.me.permissions.has = permission => permission === PermissionFlagsBits.ManageNicknames
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.summary.conflict, 1)
	f.member.roles.cache.delete(rankRoles['Tier 1'])
	f.member.roles.cache.delete(rankRoles['Tier 2'])
	f.setFamily([{ id: 231542, login: 'Maya Well', rankName: 'Main', rankId: 1 }])
	await f.sync.autoNicknames(f.guild); await f.sync.wait(f.guild)
	assert.equal(f.edits.length, 0)
	assert.equal((await f.sync.state(f.guild)).run.summary.blocked, 1)
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
