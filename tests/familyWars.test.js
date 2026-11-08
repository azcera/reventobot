const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { createStore } = require('../src/dashboard/store')
const { rulesFromEnv, nextPollAt, normalizeWar, canAnnounce, registrationClosed, battleSummary, queueRows } = require('../src/features/capture/familyWarData')
const { announcement, registrationMessage } = require('../src/features/capture/familyWarMessages')
const { createFamilyWars } = require('../src/services/familyWars')

const start = Date.parse('2026-11-08T12:00:05Z')
const rawWar = (extra = {}) => ({ id: 45767, captureId: 36468, defendersId: 1698, attackersId: 1331,
	defendersName: 'REVENTO', attackersName: 'Enemy', gangZoneId: 2938, selectedMapName: 'Палето-Бей',
	startAt: '2026-11-08T12:30:00Z', status: 'unknown-upcoming-status', players: {}, ...extra })
const plain = payload => JSON.stringify(payload.components.map(component => component.toJSON()))

test('new registration uses dashboard text and button templates with live game and waiting lists', async () => {
	const f = fixture(), store = createStore()
	await store.init(require('./helpers/dashboardFixture').memoryPool())
	await store.save('templates', {
		'capture.info': '## {map} · {zone} · {status}\n{registrationStatus}{freshness}',
		'capture.confirmed': '### Участники: {count}\n{players}',
		'capture.waiting': '### Очередь: {count}\n{players}',
		'capture.sortTime': 'По времени', 'capture.sortPriority': 'По ролям',
		'registration.document': store.text('registration.document').replace('## 📢', '## Только ручная рега')
	}, store.revision, 'admin')
	const war = normalizeWar(rawWar({ players: { 1698: [{ id: 231542, name: 'Maya' }] } }), rulesFromEnv({}), null, start)
	const registration = { joins: { waiting: { joinedAt: start } }, sortMode: 'priority' }
	let output = plain(registrationMessage(war, registration, f.guild, {}, store, start))
	assert.match(output, /Палето-Бей/)
	assert.doesNotMatch(output, /Только ручная рега/)
	assert.match(output, /Участники: 1/)
	assert.match(output, /Очередь: 1/)
	assert.match(output, /<@waiting>/)
	assert.match(output, /По времени/)
	registration.sortMode = 'time'
	output = plain(registrationMessage(war, registration, f.guild, {}, store, start))
	assert.match(output, /По ролям/)
	assert.match(output, /war_join_RU8_45767/)
})

function fixture() {
	let clock = start, captures = [rawWar()], failFetch = false
	const saved = new Map(), messages = new Collection(), sent = [], logs = [], changes = []
	const guildId = '111111111111111111', userId = '222222222222222222'
	const member = { id: userId, nickname: 'Maya | 231542', user: { bot: false }, roles: { cache: new Collection() }, permissions: { has: () => true } }
	const members = new Collection([[userId, member]])
	const channel = { id: '333333333333333333', guildId,
		messages: { fetch: async value => typeof value === 'object' ? messages : messages.get(value) },
		async send(payload) {
			const message = { id: String(sent.length + 1), author: { id: 'bot' }, components: payload.components.map(component => component.toJSON()),
				async edit(next) { changes.push(next); this.components = next.components.map(component => component.toJSON()) } }
			messages.set(message.id, message); sent.push(payload)
			return message
		} }
	const guild = { id: guildId, members: { cache: members, fetch: async () => members } }
	const client = { user: { id: 'bot' }, channels: { fetch: async () => channel }, guilds: { fetch: async () => guild } }
	const pool = { async query(sql, params = []) {
		if (sql.startsWith('SELECT * FROM family_wars WHERE guild_id')) return { rows: [...saved.values()].filter(row =>
			row.guild_id === params[0] && row.registration_id && !row.registration.closedAt).map(row => structuredClone(row)) }
		if (sql.startsWith('SELECT * FROM family_wars')) return { rows: saved.has(params[1] + ':' + params[0]) ? [structuredClone(saved.get(params[1] + ':' + params[0]))] : [] }
		if (sql.startsWith('INSERT INTO family_wars')) {
			const [guild_id, war_key, data, registration, announcement_id, announcement_channel_id, announcement_state, registration_id, registration_channel_id, registration_state] = params
			saved.set(guild_id + ':' + war_key, { guild_id, war_key, data: JSON.parse(data), registration: JSON.parse(registration), announcement_id, announcement_channel_id, announcement_state, registration_id, registration_channel_id, registration_state })
		}
		return { rows: [] }
	} }
	const catalog = createStore()
	const store = { roleIds: () => [], getSetting: () => channel.id, text: (...args) => catalog.text(...args), decorate: (key, component) => component }
	let fetches = 0
	const options = { client, pool, store, env: { GUILD_ID: guildId, FAMILY_WARS_API_KEY: 'fake-key' }, now: () => clock,
		logger: { error: (...args) => logs.push(args.join(' ')) },
		fetchImpl: async () => { fetches++; if (failFetch) throw new Error('network unavailable'); return { ok: true, json: async () => ({ code: 200, status: true, result: { serverId: 'RU8', captures } }) } } }
	const service = createFamilyWars(options)
	const row = () => saved.get(guildId + ':RU8:45767')
	async function click(kind, messageId, isAdmin = true, apiId = 45767) {
		const replies = []
		await service.handle({ customId: `${kind}_RU8_${apiId}`, guild,
			user: { id: userId }, member: { ...member, permissions: { has: () => isAdmin } },
			message: { id: messageId || row().registration_id }, deferReply: async () => {}, deferUpdate: async () => {},
			editReply: async value => replies.push(value.content), followUp: async value => replies.push(value.content) })
		return replies
	}
	return { service, options, row, click, saved, sent, logs, changes, member, members, guild, channel,
		setCaptures(value) { captures = value }, setClock(value) { clock = Date.parse(value) }, setFailure(value) { failFetch = value }, fetches: () => fetches }
}

test('testcapt copies the latest finished roster, isolates it and uses real join buttons after restart', async () => {
	const f = fixture()
	const finished = rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z',
		players: { 1698: [{ id: 231542, name: 'Maya Well' }] } })
	f.setCaptures([finished, rawWar({ id: 2, status: 'finished', startAt: '2026-11-06T12:30:00Z', players: { 1698: [] } }), rawWar()])
	await f.service.poll()
	const original = structuredClone(f.row())
	const replies = []
	const message = { id: '999999999999999999', guild: f.guild, member: f.member,
		client: { familyWars: f.service }, reply: async text => replies.push(text) }
	await require('../src/commands/admin/testcapt').execute(message)
	const row = () => f.saved.get(f.guild.id + ':RU8:' + message.id)
	assert.deepEqual(row().data.roster, original.data.roster)
	assert.equal(row().data.testSource.apiId, 45767)
	assert.match(replies[0], /Тестовая регистрация/)
	assert.match(plain(f.sent.at(-1)), /Тестовая регистрация/)
	const controls = JSON.parse(plain(f.sent.at(-1)))[0].components.flatMap(component => component.components || [])
	assert.equal(controls.find(button => button.custom_id?.startsWith('war_join')).disabled, false)
	const restarted = createFamilyWars(f.options)
	const join = async () => restarted.handle({ customId: `war_join_RU8_${message.id}`, guild: f.guild,
		user: { id: f.member.id }, member: f.member, message: { id: row().registration_id },
		deferUpdate: async () => {}, followUp: async () => {} })
	await join()
	assert.match(plain(f.changes.at(-1)), /✅ <@222222222222222222>/)
	assert.match(plain(f.changes.at(-1)), /Ожидание: 0/)
	f.member.nickname = 'Maya | 999'
	await join()
	assert.match(plain(f.changes.at(-1)), /⏳ <@222222222222222222>/)
	assert.match(plain(f.changes.at(-1)), /Ожидание: 1/)
	await f.service.poll()
	assert.deepEqual(row().data.roster, original.data.roster)
	assert.deepEqual(f.row(), original)
})

test('testcapt refuses unauthorized users and missing historical roster', async () => {
	const f = fixture(), replies = []
	const message = { id: '999999999999999999', guild: f.guild,
		member: { ...f.member, permissions: { has: () => false } }, reply: async text => replies.push(text) }
	await f.service.createTestRegistration(message)
	assert.match(replies.pop(), /прав/)
	assert.equal(f.fetches(), 0)
	message.member = f.member
	await f.service.createTestRegistration(message)
	assert.match(replies.pop(), /ни одного завершённого/)
	f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z' })])
	await f.service.createTestRegistration(message)
	assert.match(replies.pop(), /Состав.*неизвестен/)
	assert.equal(f.sent.length, 0)
})

test('testcapt preserves the saved roster when API omits it and repeated execution sends once', async () => {
	const f = fixture(), replies = []
	const finished = { status: 'finished', startAt: '2026-11-07T12:30:00Z' }
	f.setCaptures([rawWar({ ...finished, players: { 1698: [{ id: 231542, name: 'Maya Well' }] } })])
	await f.service.poll()
	f.setCaptures([rawWar(finished)])
	const message = { id: '999999999999999999', guild: f.guild, member: f.member, reply: async text => replies.push(text) }
	await Promise.all([f.service.createTestRegistration(message), f.service.createTestRegistration(message)])
	assert.equal(f.sent.length, 1)
	assert.match(plain(f.sent[0]), /🎮 <@222222222222222222>/)
	assert.equal(replies.length, 2)
})

test('poll schedule stays at second 05 with Moscow boundaries, dates and year rollover', () => {
	for (const [from, to] of [
		['2026-11-08T11:59:59Z', '2026-11-08T12:00:05Z'],
		['2026-11-08T12:00:04Z', '2026-11-08T12:00:05Z'],
		['2026-11-08T12:00:05Z', '2026-11-08T12:01:05Z'],
		['2026-11-08T18:29:58Z', '2026-11-08T18:30:05Z'],
		['2026-11-08T18:30:05Z', '2026-11-09T12:00:05Z'],
		['2026-12-31T21:10:00Z', '2027-01-01T12:00:05Z']
	]) assert.equal(new Date(nextPollAt(Date.parse(from))).toISOString(), new Date(to).toISOString())
})

test('family filter, neutral rules and closed statuses work without an upcoming-status allowlist', () => {
	const rules = rulesFromEnv({})
	assert.equal(normalizeWar(rawWar({ defendersId: 12 }), rules, null, start), null)
	assert.equal(canAnnounce(normalizeWar(rawWar(), rules, null, start), start), true)
	for (const extra of [{ attackersId: 0 }, { attackersId: -1 }, { attackersName: 'Neutral territory' }, { status: 'finished' }]) {
		assert.equal(canAnnounce(normalizeWar(rawWar(extra), rules, null, start), start), false)
	}
	const custom = rulesFromEnv({ FAMILY_WARS_NEUTRAL_IDS: '777', FAMILY_WARS_NEUTRAL_NAMES: 'пустая клетка', FAMILY_WARS_CLOSED_STATUSES: 'finished,ended,cancelled' })
	assert.equal(normalizeWar(rawWar({ attackersId: 777 }), custom, null, start).neutral, true)
	assert.equal(normalizeWar(rawWar({ attackersName: 'Пустая клетка' }), custom, null, start).neutral, true)
	assert.equal(normalizeWar(rawWar({ status: 'ended' }), custom, null, start).closed, true)
})

test('missing or malformed roster preserves last known data; explicit empty roster clears it', () => {
	const rules = rulesFromEnv({})
	const previous = normalizeWar(rawWar({ players: { 1698: [{ id: 231542, name: 'Maya Well', familyId: 1698 }] } }), rules, null, start)
	for (const players of [{}, undefined, { 1698: 'unknown shape' }, { 1698: [{ id: 'bad', name: 'bad' }] }]) {
		const next = normalizeWar(rawWar({ players }), rules, previous, start + 60000)
		assert.deepEqual(next.roster, previous.roster); assert.equal(next.rosterFresh, false)
		assert.equal(next.rosterUpdatedAt, start)
	}
	assert.deepEqual(normalizeWar(rawWar({ players: { 1698: [] } }), rules, previous, start).roster, [])
})

test('poll creates one announcement, ignores finished/other/neutral captures and persists across restart', async () => {
	const f = fixture()
	f.setCaptures([rawWar(), rawWar({ id: 2, status: 'finished' }), rawWar({ id: 3, defendersId: 12 }), rawWar({ id: 4, attackersId: 0 })])
	await f.service.poll(); await f.service.poll()
	assert.equal(f.sent.length, 1); assert.equal(f.saved.size, 3)
	assert.equal(f.sent[0].enforceNonce, true)
	assert.deepEqual(f.sent[0].allowedMentions.parse, ['everyone'])
	await createFamilyWars(f.options).poll()
	assert.equal(f.sent.length, 1)
	f.setClock('2026-11-08T19:00:05Z'); await f.service.poll()
	assert.equal(f.fetches(), 3)
})

test('creating registration is idempotent and joining stays waiting until API confirms static', async () => {
	const f = fixture(); await f.service.poll()
	await Promise.all([f.click('capt_api', f.row().announcement_id), f.click('capt_api', f.row().announcement_id)])
	assert.equal(f.sent.length, 2)
	const payload = plain(f.sent[1])
	assert.ok(!payload.includes('capt_edit_time_trigger')); assert.ok(!payload.includes('capt_approve_'))
	await f.click('war_join')
	assert.match(plain(f.changes.at(-1)), /Ожидание: 1/)
	f.setCaptures([rawWar({ players: { 1698: [{ id: 231542, name: 'Maya Well', familyId: 1698 }] } })])
	await f.service.poll()
	const registration = f.changes.findLast(next => plain(next).includes('war_join_'))
	assert.match(plain(registration), /✅ <@222222222222222222>/)
	assert.match(plain(registration), /Ожидание: 0/)
	f.setCaptures([rawWar({ players: { 1698: [] } })]); await f.service.poll()
	assert.match(plain(f.changes.findLast(next => plain(next).includes('war_join_'))), /Ожидание: 1/)
})

test('registration buttons work while full guild member requests are rate limited', async () => {
	const f = fixture()
	await f.service.poll()
	await f.click('capt_api', f.row().announcement_id)
	let requests = 0
	f.guild.members.fetch = async () => {
		requests++
		throw new Error('Request with opcode 8 was rate limited. Retry after 20.127 seconds.')
	}
	for (let i = 0; i < 3; i++) {
		assert.deepEqual(await f.click('war_join'), [])
		assert.ok(f.row().registration.joins[f.member.id])
		assert.match(plain(f.changes.at(-1)), /Ожидание: 1/)
		assert.deepEqual(await f.click('war_sort'), [])
		assert.deepEqual(await f.click('war_leave'), [])
		assert.equal(f.row().registration.joins[f.member.id], undefined)
		assert.match(plain(f.changes.at(-1)), /Ожидание: 0/)
	}
	assert.equal(requests, 0)
	assert.deepEqual(f.logs, [])
})

test('game roster includes users who never clicked join and refuses ambiguous Discord bindings', () => {
	const f = fixture()
	f.members.set('other', { ...f.member, id: 'other' })
	const war = normalizeWar(rawWar({ players: { 1698: [{ id: 231542, name: 'Maya Well' }, { id: 9, name: 'No Discord' }] } }), rulesFromEnv({}), null, start)
	const rows = queueRows(war, { joins: {} }, f.members, {}, [], start)
	assert.equal(rows.length, 2); assert.equal(rows[0].userId, null); assert.equal(rows[0].conflict, true)
	const resolved = queueRows(war, { joins: {} }, f.members, { other: { excluded: true } }, [], start)
	assert.equal(resolved[0].userId, f.member.id)
})

test('API time changes update registration, finished status disables join and prevents stale clicks', async () => {
	const f = fixture(); await f.service.poll(); await f.click('capt_api', f.row().announcement_id)
	f.setCaptures([rawWar({ startAt: '2026-11-08T13:00:00Z' })]); await f.service.poll()
	assert.match(plain(f.changes.findLast(next => plain(next).includes('war_join_'))), new RegExp(String(Date.parse('2026-11-08T13:00:00Z') / 1000)))
	f.setCaptures([rawWar({ status: 'finished' })]); await f.service.poll()
	const buttons = JSON.parse(plain(f.changes.findLast(next => plain(next).includes('war_join_'))))[0].components.flatMap(component => component.components || [])
	assert.equal(buttons.find(button => button.custom_id.startsWith('war_join')).disabled, true)
	assert.match((await f.click('war_join'))[0], /завершён/)
})

test('leaving a game-confirmed player marks refusal but never changes the API roster', async () => {
	const f = fixture(); f.setCaptures([rawWar({ players: { 1698: [{ id: 231542, name: 'Maya Well' }] } })])
	await f.service.poll(); await f.click('capt_api', f.row().announcement_id); await f.click('war_leave')
	assert.equal(f.row().data.roster.length, 1)
	assert.match(plain(f.changes.findLast(next => plain(next).includes('war_join_'))), /отказ в Discord/)
})

test('game roster distinguishes Discord acceptance and resets the marker after leaving', async () => {
	const f = fixture()
	f.setCaptures([rawWar({ players: { 1698: [{ id: 231542, name: 'Maya Well' }, { id: 9, name: 'No Discord' }] } })])
	await f.service.poll(); await f.click('capt_api', f.row().announcement_id)
	const output = () => plain(f.changes.findLast(next => plain(next).includes('war_join_')))
	assert.match(output(), /🎮 <@222222222222222222>/)
	assert.match(output(), /🎮 No Discord \| 9/)
	assert.doesNotMatch(output(), /✅ <@222222222222222222>/)
	await f.click('war_join')
	assert.match(output(), /✅ <@222222222222222222>/)
	assert.match(output(), /🎮 No Discord \| 9/)
	assert.match(output(), /В игре: 2/)
	assert.match(output(), /Ожидание: 0/)
	await f.click('war_leave')
	assert.match(output(), /🎮 <@222222222222222222> — отказ в Discord/)
	assert.doesNotMatch(output(), /✅ <@222222222222222222>/)
	await f.click('war_join')
	assert.match(output(), /✅ <@222222222222222222>/)
	assert.doesNotMatch(output(), /отказ в Discord/)
})

test('API errors do not erase stored snapshots; non-admin cannot create or change sort', async () => {
	const f = fixture(); await f.service.poll()
	assert.match((await f.click('capt_api', f.row().announcement_id, false))[0], /прав/)
	assert.equal(f.sent.length, 1)
	f.setFailure(true); await assert.rejects(f.service.poll(), /network/)
	assert.equal(f.row().data.apiId, 45767)
})

test('an ambiguous send recovers the existing message after restart instead of duplicating it', async () => {
	const f = fixture(); const send = f.channel.send
	f.channel.send = async payload => { await send(payload); throw new Error('transport lost') }
	await f.service.poll()
	assert.equal(f.row().announcement_state, 'sending')
	f.channel.send = send
	await createFamilyWars(f.options).poll()
	assert.equal(f.sent.length, 1); assert.equal(f.row().announcement_state, 'sent')
})

test('time and role/time sorting preserve timestamps and show the whole queue without paging', () => {
	const f = fixture()
	const second = { ...f.member, id: 'second', nickname: 'Second | 2', roles: { cache: new Collection([['priority', {}]]) } }
	f.members.set('second', second)
	const war = normalizeWar(rawWar(), rulesFromEnv({}), null, start)
	const reg = { joins: { [f.member.id]: { joinedAt: 1 }, second: { joinedAt: 2 } }, sortMode: 'time' }
	assert.equal(queueRows(war, reg, f.members, {}, ['priority'], start)[0].userId, f.member.id)
	reg.sortMode = 'priority'
	assert.equal(queueRows(war, reg, f.members, {}, ['priority'], start)[0].userId, 'second')
	for (let i = 0; i < 55; i++) reg.joins['user' + i] = { joinedAt: i + 5 }
	const catalog = createStore()
	const payload = registrationMessage(war, reg, f.guild, {}, catalog, start)
	assert.match(plain(payload), /Ожидание: 57/)
	for (const userId of Object.keys(reg.joins)) assert.ok(plain(payload).includes(`<@${userId}>`))
	assert.ok(!plain(payload).includes('war_page_'))
	assert.ok(!plain(payload).includes('Страница'))
	assert.ok(!plain(payload).includes('capt_approve_'))
})

test('game and waiting lists have separate numbering and sorting, and confirmation removes waiting duplicates', () => {
	const f = fixture(), catalog = createStore()
	for (const [id, staticId, priority] of [['gameEarly', '1', false], ['gamePriority', '2', true],
		['waitEarly', '3', false], ['waitPriority', '4', true]]) {
		f.members.set(id, { ...f.member, id, nickname: `Player | ${staticId}`,
			roles: { cache: new Collection(priority ? [['priority', {}]] : []) } })
	}
	const war = normalizeWar(rawWar({ players: { 1698: [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }] } }), rulesFromEnv({}), null, start)
	const reg = { joins: { gameEarly: { joinedAt: 1 }, gamePriority: { joinedAt: 2 },
		waitEarly: { joinedAt: 3 }, waitPriority: { joinedAt: 4 } }, sortMode: 'priority', page: 10 }
	const store = { roleIds: () => ['priority'], text: (...args) => catalog.text(...args), decorate: (key, component) => component }
	const sections = () => registrationMessage(war, reg, f.guild, {}, store, start).components[0].toJSON().components
		.filter(component => component.type === 10).map(component => component.content)
	let content = sections()
	assert.equal(content.find(text => text.startsWith('### В игре:')), '### В игре: 2\n1. ✅ <@gamePriority>\n2. ✅ <@gameEarly>')
	assert.equal(content.find(text => text.startsWith('### Ожидание:')), '### Ожидание: 2\n1. ⏳ <@waitPriority>\n2. ⏳ <@waitEarly>')
	reg.sortMode = 'time'
	content = sections()
	assert.equal(content.find(text => text.startsWith('### В игре:')), '### В игре: 2\n1. ✅ <@gameEarly>\n2. ✅ <@gamePriority>')
	assert.equal(content.find(text => text.startsWith('### Ожидание:')), '### Ожидание: 2\n1. ⏳ <@waitEarly>\n2. ⏳ <@waitPriority>')
	war.roster.push({ static: '3', name: 'Third' })
	content = sections()
	assert.match(content.find(text => text.startsWith('### В игре:')), /3\. ✅ <@waitEarly>/)
	assert.equal(content.find(text => text.startsWith('### Ожидание:')), '### Ожидание: 1\n1. ⏳ <@waitPriority>')
	assert.equal(content.join('\n').split('<@waitEarly>').length - 1, 1)
	assert.equal(reg.joins.waitEarly.joinedAt, 3)
})

test('overlapping polls share one request and stopped scheduler cannot re-arm', async () => {
	const f = fixture()
	let release, calls = 0
	const gate = new Promise(resolve => { release = resolve })
	const callbacks = [], cleared = []
	const service = createFamilyWars({ ...f.options, fetchImpl: async (...args) => {
		calls++; await gate; return f.options.fetchImpl(...args)
	}, setTimer: (callback, delay) => { callbacks.push({ callback, delay }); return callbacks.length }, clearTimer: id => cleared.push(id) })
	service.start()
	assert.equal(callbacks[0].delay, 60000)
	const first = service.poll(), second = service.poll()
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(calls, 1)
	const stopping = service.stop(); release()
	await Promise.all([first, second, stopping])
	assert.equal(cleared.length, 1)
	assert.equal(callbacks.length, 1)
})

test('unrecoverable uncertain sends stay blocked instead of generating duplicate announcements', async () => {
	const f = fixture()
	f.channel.send = async () => { throw new Error('unknown delivery result') }
	await f.service.poll()
	assert.equal(f.row().announcement_state, 'sending')
	await f.service.poll()
	assert.equal(f.sent.length, 0)
	assert.ok(f.logs.some(line => line.includes('Неопределённый результат отправки')))
})

test('announcements use attacker/defender IDs, unknown/missing payloads cannot turn into empty state', async () => {
	const f = fixture()
	f.setCaptures([rawWar({ attackersId: 1698, defendersId: 1331, defendersName: 'Defender' })])
	await f.service.poll()
	assert.equal(f.row().data.attack, true); assert.equal(f.row().data.enemy, 'Defender')
	assert.match(plain(f.sent[0]), /АТАКУ/)
	const broken = createFamilyWars({ ...f.options, fetchImpl: async () => ({ ok: true, json: async () => ({ code: 200, status: true, result: {} }) }) })
	await assert.rejects(broken.poll(), /формат/)
	assert.equal(f.row().data.enemy, 'Defender')
})

test('API key is sent as x-api-key only to the fixed source and invalid credentials never enter logs', async () => {
	const f = fixture()
	const request = f.options.fetchImpl
	const service = createFamilyWars({ ...f.options,
		fetchImpl: async (url, options) => {
			assert.equal(url, 'https://api.majestic-files.net/v1/ext/family-wars/RU8')
			assert.equal(options.headers['x-api-key'], 'fake-key')
			assert.equal(options.redirect, 'error')
			return request(url, options)
		} })
	await service.poll()
	const invalid = createFamilyWars({ ...f.options, env: { ...f.options.env, FAMILY_WARS_API_KEY: 'secret\r\ninjection' } })
	await assert.rejects(invalid.poll(), error => error.message.includes('FAMILY_WARS_API_KEY') && !error.message.includes('secret'))
	const withoutKey = createFamilyWars({ ...f.options, env: { GUILD_ID: f.options.env.GUILD_ID }, fetchImpl: async () => { throw new Error('Request must not be sent') } })
	await assert.rejects(withoutKey.poll(), /Заполните FAMILY_WARS_API_KEY/)
	const forbidden = createFamilyWars({ ...f.options, fetchImpl: async () => ({ ok: false, status: 403 }) })
	await assert.rejects(forbidden.poll(), /доступ отклонён/)
})

test('result uses winner ID only, accepting numeric strings and preferring winnerId', () => {
	const summary = extra => battleSummary(normalizeWar(rawWar(extra), rulesFromEnv({}), null, start))
	for (const winner of [1698, '1698']) assert.equal(summary({ status: 'finished', winner }).result, 'Победа')
	for (const winner of [1331, '1331']) assert.equal(summary({ status: 'finished', winner }).result, 'Поражение')
	assert.equal(summary({ winner: 1698, winnerId: 1331 }).result, 'Победа')
	assert.equal(summary({ winner: null, winnerId: 1698 }).result, 'Победа')
	for (const winnerId of [1698, '1698']) assert.equal(summary({ winnerId }).result, 'Победа')
	for (const winnerId of [1331, '1331']) assert.equal(summary({ winnerId }).result, 'Поражение')
	assert.equal(summary({ winnerId: '1698', winnerFamilyId: 1331 }).result, 'Победа')
	assert.equal(summary({ winnerFamilyId: 1331 }).result, 'Поражение')
	for (const winnerId of [undefined, null, 0, '', 'bad', 999]) {
		assert.equal(summary({ status: 'finished', winnerId, score: { 1698: 10, 1331: 0 } }).result, 'Неопределено')
	}
})

test('announcement restores Telegram layout and shows own-family MVPs with unambiguous static bindings', () => {
	const f = fixture()
	const war = normalizeWar(rawWar({ status: 'finished', winnerId: '1698', selectedMapName: null, players: {
		1698: [{ id: 231542, name: 'Maya Well', damage: 1500, kills: 2 },
			{ id: 42, name: 'Other Player', damage: 1000, kills: 5 }],
		1331: [{ id: 7, name: 'Enemy MVP', damage: 99999, kills: 99 }]
	} }), rulesFromEnv({}), null, start)
	const payload = announcement(war, null, start, f.members.values())
	const rendered = plain(payload)
	assert.match(rendered, /attachment:\/\/capt.png/)
	assert.match(rendered, /# 🛡️ КАПТ ЗАЩИТА 🛡️/)
	assert.match(rendered, /> ### 🆚 Против: `Enemy`/)
	assert.match(rendered, /08.11.2026 15:30:00/)
	assert.match(rendered, /Карта: `Неопределена`/)
	assert.match(rendered, /🏆 Результат: `Победа`/)
	assert.match(rendered, /Статус: `finished`/)
	assert.match(rendered, /💥 MVP по урону: <@222222222222222222> — \*\*1500\*\*/)
	assert.doesNotMatch(rendered, /Maya Well/)
	assert.match(rendered, /🎯 MVP по киллам: `Other Player` \/ `42` — \*\*5\*\*/)
	assert.doesNotMatch(rendered, /Осталось|Статус API|Enemy MVP/)
	assert.equal(payload.files[0].name, 'capt.png')
	assert.deepEqual(payload.allowedMentions, { parse: [] })
	f.member.nickname = 'Maya | 999'
	assert.match(plain(announcement(war, null, start, f.members.values(), { [f.member.id]: { static: '231542' } })), /<@222222222222222222>/)
	f.members.set('duplicate', { ...f.member, id: 'duplicate', nickname: 'Copy | 231542' })
	assert.doesNotMatch(plain(announcement(war, null, start, f.members.values(), { [f.member.id]: { static: '231542' } })), /<@/)
	war.status = 'upcoming'
	assert.doesNotMatch(plain(announcement(war, null, start)), /MVP/)
	war.status = 'finished'; war.raw.players = {}
	assert.match(plain(announcement(war, null, start)), /MVP по урону: Неопределено/)
})

test('registration deadline follows changed start time and freezes registration while announcement keeps updating', async () => {
	const f = fixture()
	await f.service.poll(); await f.click('capt_api', f.row().announcement_id)
	f.setCaptures([rawWar({ startAt: '2026-11-08T13:00:00Z' })]); await f.service.poll()
	f.setClock('2026-11-08T12:27:00Z'); await f.service.poll()
	assert.equal(f.row().registration.closedAt, undefined)
	assert.equal(registrationClosed(f.row().data, Date.parse('2026-11-08T12:56:59.999Z')), false)
	f.setClock('2026-11-08T12:57:00Z'); await f.service.poll()
	assert.ok(f.row().registration.closedAt)
	const frozen = f.changes.findLast(payload => plain(payload).includes('war_join_'))
	assert.match(plain(frozen), /Регистрация закрыта/)
	const buttons = JSON.parse(plain(frozen))[0].components.flatMap(component => component.components || [])
	assert.ok(buttons.every(button => button.disabled))
	assert.match((await f.click('war_join'))[0], /Регистрация закрыта/)
	assert.match((await f.click('war_sort'))[0], /Регистрация закрыта/)
	f.setCaptures([rawWar({ startAt: '2026-11-08T13:05:00Z', selectedMapName: 'Другая карта', score: { 1698: 0, 1331: 10 } })])
	const edits = f.changes.length
	await f.service.poll()
	assert.equal(f.changes.length, edits + 1)
	assert.match(plain(f.changes.at(-1)), /Другая карта/)
	assert.doesNotMatch(plain(f.changes.at(-1)), /Осталось/)
	assert.equal(f.changes.findLast(payload => plain(payload).includes('war_join_')), frozen)
	f.setCaptures([rawWar({ status: 'finished', score: { 1698: 0, 1331: 1 }, winnerFamilyId: 1331 })])
	await f.service.poll()
	assert.doesNotMatch(plain(f.changes.at(-1)), /Осталось/)
	assert.match(plain(f.changes.at(-1)), /Поражение/)
	const finalRow = structuredClone(f.row()), finalEdits = f.changes.length
	f.setCaptures([rawWar({ selectedMapName: 'Should not update' })])
	await createFamilyWars(f.options).poll()
	assert.deepEqual(f.row(), finalRow)
	assert.equal(f.changes.length, finalEdits)
})

test('restart restores exact closure timer and API failure does not prevent registration closure', async () => {
	const f = fixture()
	await f.service.poll(); await f.click('capt_api', f.row().announcement_id)
	const timers = [], cleared = []
	const service = createFamilyWars({ ...f.options,
		setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer },
		clearTimer: timer => cleared.push(timer) })
	service.start()
	await new Promise(resolve => setImmediate(resolve))
	const deadline = timers.find(timer => timer.delay === 27 * 60000 - 5000)
	assert.ok(deadline)
	f.setClock('2026-11-08T12:27:00Z')
	f.setFailure(true)
	await deadline.callback()
	assert.ok(f.row().registration.closedAt)
	assert.match(plain(f.changes.findLast(payload => plain(payload).includes('war_join_'))), /Регистрация закрыта/)
	await assert.rejects(service.poll(), /network/)
	await service.stop()
	assert.ok(cleared.length > 0)
})

test('finished announcement loads MVP bindings even without a registration', async () => {
	const f = fixture()
	await f.service.poll()
	let fetches = 0
	f.guild.members.fetch = async () => { fetches++; return f.members }
	f.setCaptures([rawWar({ status: 'finished', winnerId: '1698', players: {
		1698: [{ id: 231542, name: 'Maya Well', damage: 1500, kills: 5 }]
	} })])
	await f.service.poll()
	assert.equal(fetches, 1)
	assert.equal(f.row().registration_id, null)
	assert.match(plain(f.changes.at(-1)), /MVP по урону: <@222222222222222222>/)
	assert.match(plain(f.changes.at(-1)), /🏆 Результат: `Победа`/)
	assert.deepEqual(f.changes.at(-1).attachments, [])
})

test('testcapt info attack selects the latest finished attack from API rather than a newer defence', async () => {
	const f = fixture(), replies = []
	const attack = { attackersId: 1698, defendersId: 1331, attackersName: 'REVENTO', defendersName: 'Enemy' }
	f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z' }),
		rawWar({ ...attack, id: 2, status: 'finished', startAt: '2026-11-06T12:30:00Z', winner: 1698 }),
		rawWar({ ...attack, id: 3, status: 'finished', startAt: '2026-11-05T12:30:00Z' }),
		rawWar({ ...attack, id: 4 }),
		rawWar({ ...attack, id: 5, status: 'finished', startAt: '2026-11-09T12:30:00Z' })])
	const message = { guild: f.guild, member: f.member, client: { familyWars: f.service },
		reply: async payload => replies.push(payload) }
	await require('../src/commands/admin/testcapt').execute(message, ['info', 'attack'])
	const payload = plain(replies.pop())
	assert.match(payload, /Просмотр последнего завершённого капта №2/)
	assert.match(payload, /# ⚔️ КАПТ АТАКА ⚔️/)
	assert.match(payload, /Против: `Enemy`/)
	assert.match(payload, /🏆 Результат: `Победа`/)
	assert.equal(f.saved.size, 0)
	assert.equal(f.sent.length, 0)
	f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z' })])
	await require('../src/commands/admin/testcapt').execute(message, ['info', 'attack'])
	assert.match(replies.pop(), /не вернул.*атакующей/)
})

test('testcapt info attack retries the gateway member limit before replying', async () => {
	const f = fixture(), waits = [], replies = []
	f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z',
		attackersId: 1698, defendersId: 1331 })])
	const service = createFamilyWars({ ...f.options, sleep: async ms => waits.push(ms) })
	let requests = 0
	f.guild.members.fetch = async () => {
		if (++requests === 1) throw Object.assign(new Error('rate limited'), {
			name: 'GatewayRateLimitError', data: { opcode: 8, retry_after: 16.313 } })
		return f.members
	}
	await require('../src/commands/admin/testcapt').execute({ guild: f.guild, member: f.member,
		client: { familyWars: service }, reply: async payload => replies.push(payload) }, ['info', 'attack'])
	assert.equal(requests, 2)
	assert.deepEqual(waits, [16563])
	assert.match(plain(replies[0]), /Просмотр последнего завершённого капта/)
})

test('capture previews share member loads and reuse the live cache for thirty seconds', async () => {
	const f = fixture()
	f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z' })])
	let requests = 0, release
	f.guild.members.fetch = () => { requests++; return new Promise(resolve => { release = () => resolve(f.members) }) }
	const message = { guild: f.guild, member: f.member, reply: async () => {} }
	const first = f.service.createTestRegistration(message, { preview: true })
	const second = f.service.createTestRegistration(message, { preview: true })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(requests, 1)
	release()
	await Promise.all([first, second])
	await f.service.createTestRegistration(message, { preview: true })
	assert.equal(requests, 1)
	f.setClock('2026-11-08T12:00:35Z')
	f.guild.members.fetch = async () => { requests++; return f.members }
	await f.service.createTestRegistration(message, { preview: true })
	assert.equal(requests, 2)
})

test('capture member retries are bounded, reject invalid limits and allow recovery', async () => {
	for (const [name, data, expectedRequests] of [
		['GatewayRateLimitError', { opcode: 8, retry_after: 1 }, 3],
		['Error', { opcode: 8, retry_after: 1 }, 1],
		['GatewayRateLimitError', { opcode: 1, retry_after: 1 }, 1],
		['GatewayRateLimitError', { opcode: 8, retry_after: -1 }, 1],
		['GatewayRateLimitError', { opcode: 8, retry_after: 61 }, 1],
		['GatewayRateLimitError', { opcode: 8, retry_after: NaN }, 1]
	]) {
		const f = fixture(), waits = []
		f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z' })])
		const service = createFamilyWars({ ...f.options, sleep: async ms => waits.push(ms) })
		const error = Object.assign(new Error('fetch failed'), { name, data })
		let requests = 0
		f.guild.members.fetch = async () => { requests++; throw error }
		const message = { guild: f.guild, member: f.member, reply: async () => {} }
		await assert.rejects(service.createTestRegistration(message, { preview: true }), error)
		assert.equal(requests, expectedRequests)
		assert.equal(waits.length, expectedRequests - 1)
		f.guild.members.fetch = async () => { requests++; return f.members }
		await service.createTestRegistration(message, { preview: true })
		assert.equal(requests, expectedRequests + 1)
	}
})

test('testcapt info previews latest finished announcement with historical time, map, result and MVPs', async () => {
	const f = fixture(), replies = []
	f.setCaptures([rawWar({ status: 'finished', startAt: '2026-11-07T12:30:00Z', score: { 1698: 0, 1331: 10 }, winner: 1331,
		players: { 1698: [{ id: 231542, name: 'Maya Well', damage: 1500, kills: 5 }] } }),
		rawWar({ id: 2, status: 'finished', startAt: '2026-11-06T12:30:00Z' }), rawWar()])
	await require('../src/commands/admin/testcapt').execute({ guild: f.guild, member: f.member,
		client: { familyWars: f.service }, reply: async payload => replies.push(payload) }, ['info'])
	const payload = plain(replies[0])
	assert.match(payload, /Просмотр последнего завершённого капта №45767/)
	assert.doesNotMatch(payload, /Осталось/)
	assert.match(payload, /MVP по урону/)
	assert.match(payload, /<@222222222222222222>/)
	assert.match(payload, /Поражение/)
	assert.match(payload, /Палето-Бей/)
	assert.match(payload, /07.11.2026 15:30:00/)
	assert.equal(f.saved.size, 0)
	assert.equal(f.sent.length, 0)
})
