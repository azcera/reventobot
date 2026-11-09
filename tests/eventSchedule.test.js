const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { upcomingEvents, buildSchedule, createEventSchedule, canCreateGroup, selectionId, getSchedule } = require('../src/services/eventSchedule')

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
	assert.equal(container.components[0].type, 12)
	assert.equal(container.components[0].items[0].media.url, 'attachment://schedule.png')
	assert.equal(payload.files[0].name, 'schedule.png')
	const banner = require('node:fs').readFileSync(payload.files[0].attachment)
	assert.ok(Math.abs(banner.readUInt32BE(16) / banner.readUInt32BE(20) - 2584 / 924) < 0.01)
	assert.match(container.components[1].content, /^## /)
	assert.match(container.components[2].components[0].content, /Тайники/)
	assert.equal(container.components[2].accessory.custom_id, `schedule_group_stash_${Date.parse('2026-11-08T22:00:00+03:00') / 1000}`)
	assert.equal(container.components[2].accessory.disabled, false)
	assert.equal(container.accent_color, null)
	assert.match(container.components[2].components[0].content, /🔒 Ближайшее/)
	assert.equal(container.components[3].type, 14)
	assert.match(container.components[4].content, /📍.*00:00.*Дроп \(завтра\)/)
	assert.match(container.components[4].content, /🏭/)
	assert.match(container.components[4].content, /^### /)
	assert.doesNotMatch(container.components[4].content, /Тайники/)
	assert.match(container.components[6].content, /🚚.*Поставки/)
	assert.match(container.components[8].content, /⚔️.*пн, ср, пт, сб/)
	const separators = container.components.filter(component => component.type === 14)
	assert.equal(separators.length, 3)
	assert.ok(separators.every(component => component.spacing === 2 && component.divider !== false))
	assert.doesNotMatch(JSON.stringify(container), /https:|Mitsuki Hub|ADMIN_ROLES|доступно администраторам/)
	const stale = buildSchedule(events, now, true, now).components[0].toJSON()
	assert.equal(stale.components[2].accessory.disabled, true)
	assert.match(stale.components.at(-1).content, /Источник недоступен/)
})

test('capture status follows Moscow weekdays and includes start but excludes end', () => {
	for (let day = 9; day <= 15; day++) {
		for (const time of ['14:59', '15:00', '18:00', '20:59', '21:00', '23:59']) {
			const timestamp = Date.parse(`2026-11-${String(day).padStart(2, '0')}T${time}:00+03:00`)
			const active = [9, 11, 13, 14].includes(day) && time >= '15:00' && time < '21:00'
			const container = buildSchedule(getSchedule(timestamp).events, timestamp, false, timestamp).components[0].toJSON()
			const captures = container.components.find(component => component.content?.includes('⚔️'))
			assert.equal(captures.content.split('\n').at(-1), active ? 'Капты активны' : 'Капты не активны', `${day} ${time} МСК`)
		}
	}
})

test('schedule resolves server emoji names and keeps fallback for missing or unavailable emoji', () => {
	const names = ['airdrop', 'chest', 'dilers', 'ceha', 'postavka', 'ostrov', 'capts']
	const emojis = new Collection(names.map((name, index) => [name, {
		name, available: true, toString: () => `<${index === 0 ? 'a' : ''}:${name}:${100000000000000000n + BigInt(index)}>`
	}]))
	const render = () => JSON.stringify(buildSchedule(getSchedule(now).events, now, false, now, emojis).components[0].toJSON())
	const content = render()
	for (const name of ['chest', 'ceha', 'airdrop', 'postavka', 'ostrov', 'capts']) assert.ok(content.includes(emojis.get(name).toString()))
	assert.match(content, /🛡️.*Контрабанда/)
	const dealer = buildSchedule([{ id: 'dealer', label: 'Дилеры', time: '22:00' }], now, false, now, emojis).components[0].toJSON()
	assert.ok(JSON.stringify(dealer).includes(emojis.get('dilers').toString()))
	emojis.get('chest').available = false
	emojis.delete('ceha')
	assert.match(render(), /🔒 Ближайшее/)
	assert.match(render(), /🏭/)
})

test('compact list shows three following events without duplicating nearest', () => {
	const manyEvents = Array.from({ length: 8 }, (_, index) => ({ id: `event${index}`, label: `Event ${index}`, time: `${String(index + 1).padStart(2, '0')}:00`, days: [] }))
	const container = buildSchedule(manyEvents, now, false, now).components[0].toJSON()
	assert.equal(container.components[4].content.split('\n').length, 3)
	assert.doesNotMatch(container.components[4].content, /Event 0|Event 4/)
})

test('administrator and configured roles are accepted, regular members denied', () => {
	const store = { roleIds: () => ['admin-role'] }
	const member = (admin, roles) => ({ permissions: { has: () => admin }, roles: { cache: new Collection(roles.map(id => [id, { id }])) } })
	assert.equal(canCreateGroup(member(true, []), store), true)
	assert.equal(canCreateGroup(member(false, ['admin-role']), store), true)
	assert.equal(canCreateGroup(member(false, ['member']), store), false)
})

test('local schedule includes all recurring slots, special windows and Moscow rollover', () => {
	const snapshot = getSchedule(now)
	assert.equal(snapshot.timezone, 'Europe/Moscow')
	assert.equal(snapshot.events.length, 20)
	assert.equal(new Set(snapshot.events.map(event => event.id)).size, 20)
	assert.deepEqual(snapshot.upcoming.slice(0, 4).map(event => [event.label, event.time]), [
		['Тайники', '22:00'], ['Цеха', '22:45'], ['Дроп', '00:00'], ['Тайники', '02:00']
	])
	assert.deepEqual(snapshot.events.find(event => event.id === 'captures').days, ['пн', 'ср', 'пт', 'сб'])
	assert.equal(snapshot.events.find(event => event.id === 'supply').is247, true)
	assert.equal(snapshot.events.find(event => event.id === 'island').window, true)
	assert.equal(snapshot.events.find(event => event.id === 'contraband').note, 'В 30 мин. каждого часа')
	assert.equal(getSchedule(Date.parse('2026-12-31T23:59:00+03:00')).upcoming[0].timestamp, Date.parse('2027-01-01T00:00:00+03:00'))
})

test('publication works without external requests, survives restart and refuses expired selections', async t => {
	t.mock.method(globalThis, 'fetch', async () => assert.fail('schedule must not make external requests'))
	let currentTime = now, stored, sends = 0, edits = 0
	const attachments = new Collection()
	const channel = {
		id: 'channel', guild: { emojis: { cache: new Collection([['chest', {
			name: 'chest', toString: () => '<:chest:100000000000000001>'
		}]]) } }, messages: { fetch: async id => {
			assert.equal(id, 'message')
			return { attachments, edit: async payload => {
				payload.components[0].toJSON()
				assert.equal(payload.files, undefined)
				assert.deepEqual(payload.attachments, [{ id: 'banner' }])
				edits++
			} }
		} },
		send: async payload => {
			assert.match(payload.components[0].toJSON().components[2].components[0].content, /<:chest:100000000000000001>/)
			assert.equal(payload.files[0].name, 'schedule.png')
			attachments.set('banner', { id: 'banner', name: 'schedule.png' })
			sends++
			return { id: 'message', delete: async () => {} }
		}
	}
	const dependencies = {
		client: { channels: { fetch: async () => channel } }, store: { roleIds: () => [] }, now: () => currentTime,
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
		const selection = selectionId(getSchedule(now).upcoming[0])
		assert.equal(service.resolveSelection(selection).label, 'Тайники')
		assert.equal(service.resolveSelection('stash_1'), null)
		currentTime = Date.parse('2026-11-08T22:00:00+03:00')
		await service.publish(channel)
		assert.equal(service.resolveSelection(selection), null)
		await service.stop()
		service = createEventSchedule(dependencies)
		await service.start()
		assert.equal(sends, 1)
		assert.equal(edits, 3)
		currentTime += 2 * 86400000
		await service.publish(channel)
		assert.equal(edits, 4)
		assert.ok(service.resolveSelection(selectionId(getSchedule(currentTime).upcoming[0])))
	} finally { await service.stop() }
})
