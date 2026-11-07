const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { createStore } = require('../src/dashboard/store')
const { rulesFromEnv, nextPollAt, normalizeWar, canAnnounce, queueRows } = require('../src/features/capture/familyWarData')
const { registrationMessage } = require('../src/features/capture/familyWarMessages')
const { createFamilyWars } = require('../src/services/familyWars')

const start = Date.parse('2026-11-08T12:00:05Z')
const rawWar = (extra = {}) => ({ id: 45767, captureId: 36468, defendersId: 1698, attackersId: 1331,
	defendersName: 'REVENTO', attackersName: 'Enemy', gangZoneId: 2938, selectedMapName: 'Палето-Бей',
	startAt: '2026-11-08T12:30:00Z', status: 'unknown-upcoming-status', players: {}, ...extra })
const plain = payload => JSON.stringify(payload.components.map(component => component.toJSON()))

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
	async function click(kind, messageId, isAdmin = true) {
		const replies = []
		await service.handle({ customId: `${kind}_RU8_45767`, guild,
			user: { id: userId }, member: { ...member, permissions: { has: () => isAdmin } },
			message: { id: messageId || row().registration_id }, deferReply: async () => {}, deferUpdate: async () => {},
			editReply: async value => replies.push(value.content), followUp: async value => replies.push(value.content) })
		return replies
	}
	return { service, options, row, click, saved, sent, logs, changes, member, members, guild, channel,
		setCaptures(value) { captures = value }, setClock(value) { clock = Date.parse(value) }, setFailure(value) { failFetch = value }, fetches: () => fetches }
}

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

test('time and role/time sorting preserve registration timestamps and paging omits approval menus', () => {
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
	assert.match(plain(payload), /war_page_RU8_45767_1/)
	assert.ok(!plain(payload).includes('capt_approve_'))
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
