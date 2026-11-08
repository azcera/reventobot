const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { createFamilyMembership, classify, isMembershipMessage, CHANNEL_ID, FRIEND_ROLE_ID, INTERVAL_MS } = require('../src/services/familyMembership')

function fixture(count = 3) {
	const edits = [], kicks = [], audits = [], sent = [], timers = []
	const members = new Collection()
	const pending = new Set()
	const snapshot = { members, statics: new Set(['100']), linked: new Map(), bindings: {}, source: 'RU8/1' }
	const guild = { id: 'guild', ownerId: 'owner', members: {
		me: { permissions: { has: () => true } }, fetch: async ({ user }) => user === 'actor' ? actor : members.get(user)
	}, channels: { fetch: async () => channel } }
	const actor = { id: 'actor', displayName: 'Admin', permissions: { has: () => true }, roles: { cache: new Collection() } }
	for (let index = 0; index < count; index++) {
		const id = String(222222222222220000n + BigInt(index))
		const member = { id, guild, user: { bot: false }, displayName: 'User ' + index, kickable: true, manageable: true,
			roles: { cache: new Collection([['role', { id: 'role', editable: true }]]), set: async roles => { edits.push({ id, roles }) } },
			kick: async () => { kicks.push(id); members.delete(id) } }
		members.set(id, member)
	}
	const channel = { isTextBased: () => true, messages: { fetch: async () => new Collection() }, send: async payload => { sent.push(payload) } }
	const sync = { membershipSnapshot: async () => snapshot }
	const pool = { query: async () => ({ rows: [...pending].map(user_id => ({ user_id })) }) }
	const store = { ready: true, roleIds: () => [], audit: async (...args) => { audits.push(args) } }
	const env = { GUILD_ID: 'guild', MAJESTIC_SESSION_ID: 'test', MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '1' }
	let clock = 0
	const service = createFamilyMembership({ client: { user: { id: 'bot' }, guilds: { fetch: async () => guild } }, pool, sync, store, env,
		logger: { error() {} }, now: () => clock, setTimer: (callback, delay) => { timers.push({ callback, delay }); return 1 }, clearTimer() {} })
	function interaction(customId, values) {
		const replies = []
		return { customId, values, guild, channelId: CHANNEL_ID, user: { id: 'actor' }, replies,
			deferReply: async () => {}, editReply: async payload => { replies.push(payload) } }
	}
	async function open(action = 'kick', page = 0) {
		const event = interaction(`family_cleanup_open_${action}_${page}`)
		await service.handle(event)
		const data = event.replies[0].components?.[0].toJSON().components[0]
		return { event, data }
	}
	return { service, members, pending, snapshot, guild, channel, actor, pool, sync, edits, kicks, audits, sent, timers, store,
		interaction, open, expire() { clock += 6 * 60 * 1000 } }
}

test('classifies only outsiders: excludes family, FRIEND, applications, owner and bots', () => {
	const f = fixture(8)
	const list = [...f.members.values()]
	f.snapshot.linked.set(list[0].id, '100')
	list[1].roles.cache.set(FRIEND_ROLE_ID, { id: FRIEND_ROLE_ID })
	f.pending.add(list[2].id)
	list[3].user.bot = true
	f.guild.ownerId = list[4].id
	f.snapshot.bindings[list[5].id] = '99'
	const report = classify(f.snapshot, f.pending)
	assert.deepEqual(report.manual.map(member => member.id), list.slice(6).map(member => member.id))
	assert.deepEqual(report.automatic.map(member => member.id), [list[5].id])
})

test('automatically kicks former linked members and publishes only manual candidates', async () => {
	const f = fixture()
	const ids = [...f.members.keys()]
	f.snapshot.bindings[ids[0]] = '99'
	f.snapshot.bindings[ids[1]] = '98'
	f.members.get(ids[1]).kickable = false
	await f.service.refresh(f.guild)
	assert.deepEqual(f.kicks, [ids[0]])
	const payload = f.sent[0].components[0].toJSON()
	assert.ok(payload.components[0].content.includes('Не удалось автоматически кикнуть: 1'))
	assert.ok(!payload.components[0].content.includes(ids[0]))
	assert.ok(!payload.components[0].content.includes(ids[1]))
	assert.ok(payload.components[0].content.includes(ids[2]))
	assert.ok(f.audits.some(entry => entry[1] === 'family.kick.result'))
})

test('multi-select removes all roles only from selected eligible members', async () => {
	const f = fixture()
	const ids = [...f.members.keys()]
	const { data } = await f.open('roles')
	assert.equal(data.max_values, 3)
	const event = f.interaction(data.custom_id, [ids[0], ids[2]])
	await f.service.handle(event)
	assert.deepEqual(f.edits, [{ id: ids[0], roles: [] }, { id: ids[2], roles: [] }])
	assert.equal(f.kicks.length, 0)
	assert.match(event.replies[0].content, /Выполнено: 2/)
})

test('selection rechecks family membership, FRIEND, active applications and permissions', async () => {
	for (const protect of [
		(f, id) => { f.snapshot.linked.set(id, '100') },
		(f, id) => { f.pending.add(id) },
		(f, id) => { f.members.get(id).roles.cache.set(FRIEND_ROLE_ID, { id: FRIEND_ROLE_ID }) },
		f => { f.actor.permissions.has = () => false },
		f => { f.guild.members.me.permissions.has = () => false }
	]) {
		const f = fixture(1), id = [...f.members.keys()][0]
		const { data } = await f.open()
		protect(f, id)
		await f.service.handle(f.interaction(data.custom_id, [id]))
		assert.equal(f.kicks.length, 0)
	}
})

test('rechecks a newly created application immediately before the Discord mutation', async () => {
	const f = fixture(1), id = [...f.members.keys()][0]
	const { data } = await f.open()
	const fetch = f.guild.members.fetch
	f.guild.members.fetch = async options => {
		if (options.user === id) f.pending.add(id)
		return fetch(options)
	}
	await f.service.handle(f.interaction(data.custom_id, [id]))
	assert.equal(f.kicks.length, 0)
})

test('expired, replayed, foreign or tampered selections cannot execute', async () => {
	for (const mode of ['expired', 'foreign', 'tampered', 'source', 'replayed']) {
		const f = fixture(2), ids = [...f.members.keys()]
		const { data } = await f.open()
		if (mode === 'expired') f.expire()
		if (mode === 'foreign') f.actor.id = 'another'
		if (mode === 'source') f.snapshot.source = 'RU9/1'
		if (mode === 'replayed') {
			await f.service.handle(f.interaction(data.custom_id, [ids[0]]))
			f.kicks.length = 0
		}
		await f.service.handle(f.interaction(data.custom_id, [mode === 'tampered' ? 'unknown' : ids[1]]))
		assert.equal(f.kicks.length, 0, mode)
	}
})

test('managed roles prevent partial removal and failures do not stop the remaining batch', async () => {
	const f = fixture(2), ids = [...f.members.keys()]
	f.members.get(ids[0]).roles.cache.get('role').managed = true
	const { data } = await f.open('roles')
	await f.service.handle(f.interaction(data.custom_id, ids))
	assert.deepEqual(f.edits, [{ id: ids[1], roles: [] }])
})

test('pagination supports more than 25 outsiders and messages can be identified by archive updater', async () => {
	const f = fixture(60)
	await f.service.refresh(f.guild)
	assert.equal(f.sent.length, 3)
	assert.ok(f.sent.every(payload => isMembershipMessage({ components: payload.components })))
	const { data } = await f.open('kick', 2)
	assert.equal(data.options.length, 10)
	assert.deepEqual(data.options.map(option => option.value), [...f.members.keys()].slice(50))
})

test('family/API/database failures stop all moderation and leave existing list untouched', async () => {
	for (const target of ['sync', 'pool']) {
		const f = fixture()
		f.snapshot.bindings[[...f.members.keys()][0]] = '99'
		if (target === 'sync') f.sync.membershipSnapshot = async () => { throw new Error('incomplete roster') }
		else f.pool.query = async () => { throw new Error('database unavailable') }
		await assert.rejects(f.service.refresh(f.guild))
		assert.equal(f.kicks.length, 0)
		assert.equal(f.sent.length, 0)
	}
})

test('refresh edits only its own list messages and deletes obsolete list pages', async () => {
	const f = fixture(30)
	await f.service.refresh(f.guild)
	const modified = [], deleted = []
	const own = f.sent.map((payload, index) => ({ id: String(index), author: { id: 'bot' }, createdTimestamp: index,
		components: payload.components, edit: async () => { modified.push(index) }, delete: async () => { deleted.push(index) } }))
	const archive = { id: 'archive', author: { id: 'bot' }, components: [], edit: async () => { assert.fail('archive changed') } }
	f.channel.messages.fetch = async () => new Collection([...own, archive].map(message => [message.id, message]))
	f.members.clear()
	await f.service.refresh(f.guild)
	assert.deepEqual(modified, [0])
	assert.deepEqual(deleted, [1])
	assert.equal(f.sent.length, 2)
})

test('successful actions stay reported when the subsequent list refresh fails', async () => {
	const f = fixture(1), id = [...f.members.keys()][0]
	const { data } = await f.open()
	let calls = 0
	f.sync.membershipSnapshot = async () => {
		if (++calls > 1) throw new Error('API unavailable')
		return f.snapshot
	}
	const event = f.interaction(data.custom_id, [id])
	await f.service.handle(event)
	assert.deepEqual(f.kicks, [id])
	assert.match(event.replies[0].content, /Выполнено: 1/)
	assert.match(event.replies[0].content, /Не удалось обновить список/)
})

test('scheduler checks every ten minutes independently of nickname synchronization', async () => {
	const f = fixture()
	f.service.start()
	await f.timers[0].callback()
	assert.equal(f.sent.length, 1)
	assert.equal(f.timers[1].delay, INTERVAL_MS)
	await f.service.stop()
	await f.timers[1].callback()
	assert.equal(f.sent.length, 1)
})
