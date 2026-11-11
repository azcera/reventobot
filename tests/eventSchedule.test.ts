import { asMock } from './helpers/moduleStub'
import type { RawComponent } from '../src/types'
import type { MessageCreateOptions, AttachmentBuilder } from 'discord.js'
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { Collection } from 'discord.js'
import { upcomingEvents, buildSchedule as originalBuildSchedule, createEventSchedule as originalCreateEventSchedule, canCreateGroup as originalCanCreateGroup, selectionId, getSchedule } from '../src/services/eventSchedule'
interface TestComponent extends RawComponent { components: TestComponent[]; items: { media: { url: string } }[]; accessory: TestComponent; content: string; custom_id?: string }
function buildSchedule(events: Parameters<typeof originalBuildSchedule>[0], updatedAt: number, stale: boolean, now: number, emojis?: unknown) {
 const payload = originalBuildSchedule(events, updatedAt, stale, now, asMock<Parameters<typeof originalBuildSchedule>[4]>(emojis), '<img src="https://example.com/schedule.png" />')
 return { ...payload, components: asMock<{ toJSON(): TestComponent }[]>(payload.components) }
}
const createEventSchedule = (dependencies: unknown) => originalCreateEventSchedule(asMock<Parameters<typeof originalCreateEventSchedule>[0]>(dependencies))
const canCreateGroup = (member: unknown, store: unknown) => originalCanCreateGroup(asMock<Parameters<typeof originalCanCreateGroup>[0]>(member), asMock<Parameters<typeof originalCanCreateGroup>[1]>(store))

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
	const weekly = upcomingEvents([{ id: 'weekly', label: 'Weekly', time: '19:00', days: ['ср'] }], now)
	assert.equal(new Date(weekly[0].timestamp).toISOString(), '2026-11-11T16:00:00.000Z')
})

test('message has a group button beside nearest event and marks stale data', () => {
	const payload = buildSchedule(events, now, false, now)
	const container = payload.components[0].toJSON()
	assert.equal(container.components[0].type, 12)
	assert.equal(container.components[0].items[0].media.url, 'https://example.com/schedule.png')
	assert.equal(payload.files, undefined)
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
	assert.doesNotMatch(JSON.stringify(container), /Mitsuki Hub|ADMIN_ROLES|доступно администраторам/)
	const stale = buildSchedule(events, now, true, now).components[0].toJSON()
	assert.equal(stale.components[2].accessory.disabled, true)
	assert.match(stale.components.at(-1)!.content, /Источник недоступен/)
})

test('schedule does not add an image when its template is empty', () => {
	const payload = originalBuildSchedule(events, now, false, now)
	const container = asMock<{ toJSON(): TestComponent }[]>(payload.components)[0].toJSON()
	assert.equal(container.components.some(component => component.type === 12), false)
})

test('capture status follows Moscow weekdays and includes start but excludes end', () => {
	for (let day = 9; day <= 15; day++) {
		for (const time of ['14:59', '15:00', '18:00', '20:59', '21:00', '23:59']) {
			const timestamp = Date.parse(`2026-11-${String(day).padStart(2, '0')}T${time}:00+03:00`)
			const active = [9, 11, 13, 14].includes(day) && time >= '15:00' && time < '21:00'
			const container = buildSchedule(getSchedule(timestamp).events, timestamp, false, timestamp).components[0].toJSON()
			const captures = container.components.find(component => component.content?.includes('⚔️'))
			assert.equal(captures!.content.split('\n').at(-1), active ? 'Капты активны' : 'Капты не активны', `${day} ${time} МСК`)
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
	for (const name of ['chest', 'ceha', 'airdrop', 'postavka', 'ostrov', 'capts']) assert.ok(content.includes(emojis.get(name)!.toString()))
	assert.match(content, /🛡️.*Контрабанда/)
	const dealer = buildSchedule([{ id: 'dealer', label: 'Дилеры', time: '22:00', days: [] }], now, false, now, emojis).components[0].toJSON()
	assert.ok(JSON.stringify(dealer).includes(emojis.get('dilers')!.toString()))
	emojis.get('chest')!.available = false
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
	const member = (admin: boolean, roles: string[]) => ({ permissions: { has: () => admin }, roles: { cache: new Collection(roles.map(id => [id, { id }])) } })
	assert.equal(canCreateGroup(member(true, []), store), true)
	assert.equal(canCreateGroup(member(false, ['admin-role']), store), true)
	assert.equal(canCreateGroup(member(false, ['member']), store), false)
})

test('additional group role can create scheduled groups', () => {
	const store = { roleIds: (key: string) => key === 'ACCESS_GROUP_ROLES' ? ['group-role'] : [] }
	const member = (id: string) => ({ permissions: { has: () => false }, roles: { cache: new Collection([[id, { id }]]) } })
	assert.equal(canCreateGroup(member('group-role'), store), true)
	assert.equal(canCreateGroup(member('other-role'), store), false)
})

test('local schedule includes all recurring slots, special windows and Moscow rollover', () => {
	const snapshot = getSchedule(now)
	assert.equal(snapshot.timezone, 'Europe/Moscow')
	assert.equal(snapshot.events.length, 20)
	assert.equal(new Set(snapshot.events.map(event => event.id)).size, 20)
	assert.deepEqual(snapshot.upcoming.slice(0, 4).map(event => [event.label, event.time]), [
		['Тайники', '22:00'], ['Цеха', '22:45'], ['Дроп', '00:00'], ['Тайники', '02:00']
	])
	assert.deepEqual(snapshot.events.find(event => event.id === 'captures')!.days, ['пн', 'ср', 'пт', 'сб'])
	assert.equal(asMock<{is247: boolean}>(snapshot.events.find(event => event.id === 'supply')).is247, true)
	assert.equal(asMock<{window: boolean}>(snapshot.events.find(event => event.id === 'island')).window, true)
	assert.equal(asMock<{note: string}>(snapshot.events.find(event => event.id === 'contraband')).note, 'В 30 мин. каждого часа')
	assert.equal(getSchedule(Date.parse('2026-12-31T23:59:00+03:00')).upcoming[0].timestamp, Date.parse('2027-01-01T00:00:00+03:00'))
})

test('publication works without external requests, survives restart and refuses expired selections', async t => {
	t.mock.method(globalThis, 'fetch', async () => assert.fail('schedule must not make external requests'))
	let currentTime = now, sends = 0, edits = 0
	let stored: { channel_id: string; message_id: string } | undefined
	const attachments = new Collection()
	const channel = {
		id: 'channel', isTextBased: () => true, guild: { emojis: { cache: new Collection([['chest', {
			name: 'chest', toString: () => '<:chest:100000000000000001>'
		}]]) } }, messages: { fetch: async (id: string) => {
			assert.equal(id, 'message')
			return { attachments, edit: async (payload: ReturnType<typeof buildSchedule>) => {
				payload.components[0].toJSON()
				assert.equal(payload.files, undefined)
				assert.equal(payload.attachments, undefined)
				edits++
			} }
		} },
		send: async (payload: ReturnType<typeof buildSchedule>) => {
			assert.match(payload.components[0].toJSON().components[2].components[0].content, /<:chest:100000000000000001>/)
			assert.equal(payload.files, undefined)
			attachments.set('banner', { id: 'banner', name: 'schedule.png' })
			sends++
			return { id: 'message', delete: async () => {} }
		}
	}
	const dependencies = {
		client: { channels: { fetch: async () => channel } }, store: { roleIds: () => [], text: (key: string, variables?: Record<string, unknown>) => key === 'schedule.banner' ? '<img src="https://example.com/schedule.png" />' : require('../src/dashboard/templateText').templateText(key, variables) }, now: () => currentTime,
		pool: { query: async (sql: string, params: string[]) => {
			if (sql.startsWith('INSERT')) stored = { channel_id: params[0], message_id: params[1] }
			return { rows: sql.startsWith('SELECT') && stored ? [stored] : [] }
		} }
	}
	let service = createEventSchedule(dependencies)
	try {
		await service.start()
		await Promise.all([service.publish(asMock<Parameters<typeof service.publish>[0]>(channel)), service.publish(asMock<Parameters<typeof service.publish>[0]>(channel))])
		assert.equal(sends, 1)
		assert.equal(edits, 1)
		const selection = selectionId(getSchedule(now).upcoming[0])
		assert.equal(service.resolveSelection(selection)!.label, 'Тайники')
		assert.equal(service.resolveSelection('stash_1'), null)
		currentTime = Date.parse('2026-11-08T22:00:00+03:00')
		await service.publish(asMock<Parameters<typeof service.publish>[0]>(channel))
		assert.equal(service.resolveSelection(selection), null)
		await service.stop()
		service = createEventSchedule(dependencies)
		await service.start()
		assert.equal(sends, 1)
		assert.equal(edits, 3)
		currentTime += 2 * 86400000
		await service.publish(asMock<Parameters<typeof service.publish>[0]>(channel))
		assert.equal(edits, 4)
		assert.ok(service.resolveSelection(selectionId(getSchedule(currentTime).upcoming[0])))
	} finally { await service.stop() }
})


test('schedule uses editable text while keeping live event data and button actions', () => {
	const { templateText } = require('../src/dashboard/templateText')
	const payload = originalBuildSchedule(getSchedule(now).events, now, false, now, undefined, '', (key, variables) => {
		if (key === 'schedule.title') return '## Наши события'
		if (key === 'schedule.button') return 'Записаться'
		if (key === 'schedule.nearest') return 'Сейчас: ' + variables!.event
		return templateText(key, variables)
	})
	const result = JSON.stringify(asMock<{ toJSON(): unknown }>(payload.components![0]).toJSON())
	assert.match(result, /Наши события/)
	assert.match(result, /Сейчас: Тайники/)
	assert.match(result, /Записаться/)
	assert.match(result, /schedule_group_/)
})
