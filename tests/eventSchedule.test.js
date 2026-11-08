const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { upcomingEvents, buildSchedule, createEventSchedule, canCreateGroup, selectionId } = require('../src/services/eventSchedule')

const now = Date.parse('2026-11-08T20:46:00+03:00')
const events = [
	{ id: 'drop', label: 'Дроп', time: '00:00', days: [] },
	{ id: 'stash', label: 'Тайники', time: '22:00', days: [] },
	{ id: 'factory', label: 'Цеха', time: '22:45', days: [] },
	{ id: 'supply', label: 'Поставки', time: '24/7', is247: true, days: [], note: 'Безопасный час 15–16:00' },
	{ id: 'captures', label: 'Капты', time: '15:00–21:00', days: ['пн', 'ср', 'пт', 'сб'] }
]

test('nearest event, Moscow midnight, daily windows and weekly days', () => {
	const upcoming = upcomingEvents(events, now)
	assert.deepEqual(upcoming.map(event => event.id), ['stash', 'factory', 'drop'])
	assert.equal(new Date(upcoming[2].timestamp).toISOString(), '2026-11-08T21:00:00.000Z')
	assert.equal(upcomingEvents(events, upcoming[0].timestamp)[0].id, 'factory')
	const weekly = upcomingEvents([{ id: 'weekly', time: '19:00', days: ['ср'] }], now)
	assert.equal(new Date(weekly[0].timestamp).toISOString(), '2026-11-11T16:00:00.000Z')
})

test('message has a group button beside nearest event and marks stale data', () => {
	const payload = buildSchedule(events, now, false, now)
	const container = payload.components[0].toJSON()
	assert.match(container.components[1].components[0].content, /Тайники/)
	assert.equal(container.components[1].accessory.custom_id, `schedule_group_stash_${Date.parse('2026-11-08T22:00:00+03:00') / 1000}`)
	assert.equal(container.components[1].accessory.disabled, false)
	assert.match(container.components[2].content, /00:00.*Дроп \(завтра\)/)
	assert.match(container.components[2].content, /пн, ср, пт, сб/)
	const stale = buildSchedule(events, now, true, now).components[0].toJSON()
	assert.equal(stale.components[1].accessory.disabled, true)
	assert.match(stale.components[3].content, /Источник недоступен/)
})

test('administrator and configured roles are accepted, regular members denied', () => {
	const store = { roleIds: () => ['admin-role'] }
	const member = (admin, roles) => ({ permissions: { has: () => admin }, roles: { cache: new Collection(roles.map(id => [id, { id }])) } })
	assert.equal(canCreateGroup(member(true, []), store), true)
	assert.equal(canCreateGroup(member(false, ['admin-role']), store), true)
	assert.equal(canCreateGroup(member(false, ['member']), store), false)
})

test('publication survives restart, refreshes from source and refuses stale selections', async () => {
	let currentTime = now, stored, sends = 0, edits = 0, sourceEvents = events, fail = false
	const channel = {
		id: 'channel', messages: { fetch: async id => { assert.equal(id, 'message'); return { edit: async payload => { payload.components[0].toJSON(); edits++ } } } },
		send: async payload => { payload.components[0].toJSON(); sends++; return { id: 'message', delete: async () => {} } }
	}
	const dependencies = {
		client: { channels: { fetch: async () => channel } }, store: { roleIds: () => [] }, now: () => currentTime,
		fetchImpl: async () => ({ ok: !fail, status: fail ? 503 : 200, json: async () => ({ events: sourceEvents }) }),
		pool: { query: async (sql, params) => {
			if (sql.startsWith('INSERT')) stored = { channel_id: params[0], message_id: params[1] }
			return { rows: sql.startsWith('SELECT') && stored ? [stored] : [] }
		} }
	}
	let service = createEventSchedule(dependencies)
	try {
		await service.start()
		await Promise.all([service.publish(channel), service.publish(channel)])
		assert.equal(sends, 1)
		assert.equal(edits, 1)
		const selection = selectionId(upcomingEvents(events, now)[0])
		assert.equal(service.resolveSelection(selection).label, 'Тайники')
		assert.equal(service.resolveSelection('stash_1'), null)
		currentTime += 5 * 60000
		sourceEvents = events.filter(event => event.id !== 'stash')
		await service.publish(channel)
		assert.equal(service.resolveSelection(selection), null)
		await service.stop()
		service = createEventSchedule(dependencies)
		await service.start()
		assert.equal(sends, 1)
		assert.equal(edits, 3)
		currentTime += 5 * 60000
		fail = true
		await assert.rejects(service.publish(channel), /актуальное расписание/)
		assert.equal(service.resolveSelection(selectionId(upcomingEvents(sourceEvents, currentTime)[0])), null)
	} finally { await service.stop() }
})
