const { test } = require('node:test')
const assert = require('node:assert/strict')

const dbPath = require.resolve('../src/services/database')
let row
const client = {
	async query(sql, params) {
		if (sql.startsWith('SELECT')) return { rows: [row] }
		if (sql.includes('SET approved_users =')) {
			row.approved_users = JSON.parse(params[0])
			row.approval_page = params[1]
			row.sort_mode = params[7]
			;[
				row.main_list,
				row.reserve_list,
				row.main_list_meta,
				row.reserve_list_meta
			] = params.slice(2, 6).map(JSON.parse)
		}
		if (sql.includes('SET main_list =')) {
			;[
				row.main_list,
				row.reserve_list,
				row.left_list,
				row.main_list_meta,
				row.reserve_list_meta,
				row.approved_users
			] = params.slice(0, 6).map(JSON.parse)
		}
		return { rows: [] }
	},
	release() {}
}
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: { connect: async () => client, query: (...args) => client.query(...args) }
}
const manager = require('../src/features/capture/captureManager')
const guild = { members: { cache: new Map() } }
const admin = { permissions: { has: () => true }, roles: { cache: new Map() } }
const ids = Array.from({ length: 30 }, (_, i) => String(1000 + i))

test('capture button stops if Discord acknowledgement fails', async () => {
	const pool = require('../src/services/database')
	const connect = pool.connect
	pool.connect = async () => assert.fail('database must not be accessed')
	try {
		await manager.handleButton({ isButton: () => true, customId: 'capt_join',
			deferUpdate: async () => { throw new Error('expired interaction') } })
	} finally { pool.connect = connect }
})

test('capture button reports a database connection failure', async () => {
	const pool = require('../src/services/database')
	const connect = pool.connect
	let reply
	pool.connect = async () => { throw new Error('connection timeout') }
	try {
		await manager.handleButton({ isButton: () => true, customId: 'capt_join',
			deferUpdate: async () => {}, message: { id: 'm' }, user: { id: 'u' },
			followUp: async payload => { reply = payload } })
		assert.match(reply.content, /ошибка базы данных/)
	} finally { pool.connect = connect }
})

test('approval across menus survives reload and is removed on leave', async () => {
	row = {
		message_id: 'm',
		discord_timestamp: 'now',
		main_list: ids.slice(0, 20),
		reserve_list: ids.slice(20),
		left_list: [],
		main_list_meta: [],
		reserve_list_meta: [],
		approved_users: [],
		approval_page: 0,
		max_main: 20
	}
	let payload = manager.buildCaptureMessage(
		'now',
		row.main_list,
		row.reserve_list,
		[],
		'test',
		20,
		guild
	)
	assert.equal(payload.components.length, 4)
	const menus = payload.components
		.slice(2)
		.map(item => item.toJSON().components[0])
	assert.equal(menus[0].options.length, 25)
	assert.equal(menus[1].options.length, 5)
	const interaction = {
		member: admin,
		guild,
		message: { id: 'm' },
		values: [ids[0]],
		customId: menus[0].custom_id,
		isStringSelectMenu: () => true,
		deferUpdate: async () => {},
		editReply: async value => {
			payload = value
		},
		followUp: async () => {}
	}
	await manager.handleApproval(interaction)
	assert.deepEqual(row.main_list, [ids[0]])
	assert.equal(row.reserve_list.length, 29)
	interaction.customId = menus[1].custom_id
	interaction.values = [ids[29]]
	await manager.handleApproval(interaction)
	assert.deepEqual(row.approved_users, [ids[0], ids[29]])
	assert.deepEqual(row.main_list, [ids[0], ids[29]])
	delete require.cache[
		require.resolve('../src/features/capture/captureManager')
	]
	const reloaded = require('../src/features/capture/captureManager')
	payload = reloaded.buildCaptureMessage(
		'now',
		row.main_list,
		row.reserve_list,
		[],
		'test',
		20,
		guild,
		[],
		[],
		row.approved_users
	)
	assert.equal(
		payload.components[2].toJSON().components[0].options[0].default,
		true
	)
	await reloaded.handleButton({
		isButton: () => true,
		customId: 'capt_leave',
		deferUpdate: async () => {},
		message: { id: 'm' },
		user: { id: ids[0] },
		guild,
		editReply: async () => {},
		followUp: async () => {}
	})
	assert.deepEqual(row.approved_users, [ids[29]])
	assert.deepEqual(row.main_list, [ids[29]])
	await reloaded.handleButton({
		isButton: () => true,
		customId: 'capt_join',
		deferUpdate: async () => {},
		message: { id: 'm' },
		user: { id: 'new' },
		guild,
		editReply: async () => {},
		followUp: async () => {}
	})
	assert.deepEqual(row.main_list, [ids[29]])
	assert.ok(row.reserve_list.includes('new'))
})

test('approval requires permission and rejects stale menus', async () => {
	let replies = []
	const interaction = {
		member: { permissions: { has: () => false }, roles: { cache: new Map() } },
		reply: async value => replies.push(value)
	}
	await manager.handleApproval(interaction)
	assert.match(replies[0].content, /нет прав/)
	await manager.handleApproval({
		member: admin,
		guild,
		message: { id: 'm' },
		customId: 'capt_approve_stale',
		values: [],
		isStringSelectMenu: () => true,
		deferUpdate: async () => {},
		followUp: async value => replies.push(value)
	})
	assert.match(replies[1].content, /изменился/)
})

test('clearing the last approval restores the original join order', async () => {
	row = {
		message_id: 'm',
		discord_timestamp: 'now',
		main_list: ids.slice(0, 3),
		reserve_list: ids.slice(3, 6),
		left_list: [],
		main_list_meta: ids
			.slice(0, 3)
			.map((userId, joinedAt) => ({ userId, joinedAt })),
		reserve_list_meta: ids
			.slice(3, 6)
			.map((userId, i) => ({ userId, joinedAt: i + 3 })),
		approved_users: [],
		approval_page: 0,
		max_main: 3
	}
	let payload = manager.buildCaptureMessage(
		'now',
		row.main_list,
		row.reserve_list,
		[],
		'test',
		3,
		guild,
		row.main_list_meta,
		row.reserve_list_meta
	)
	const menuId = payload.components[2].toJSON().components[0].custom_id
	const interaction = {
		member: admin,
		guild,
		message: { id: 'm' },
		customId: menuId,
		values: [ids[5]],
		isStringSelectMenu: () => true,
		deferUpdate: async () => {},
		editReply: async value => {
			payload = value
		},
		followUp: async () => {}
	}
	await manager.handleApproval(interaction)
	assert.deepEqual(row.main_list, [ids[5]])
	interaction.values = []
	await manager.handleApproval(interaction)
	assert.deepEqual(row.main_list, ids.slice(0, 3))
	assert.deepEqual(row.reserve_list, ids.slice(3, 6))
	interaction.values = [ids[5]]
	await manager.handleApproval(interaction)
	await manager.handleButton({
		isButton: () => true,
		customId: 'capt_leave',
		deferUpdate: async () => {},
		message: { id: 'm' },
		user: { id: ids[5] },
		guild,
		editReply: async () => {},
		followUp: async () => {}
	})
	assert.deepEqual(row.main_list, ids.slice(0, 3))
	assert.deepEqual(row.reserve_list, ids.slice(3, 5))
})

test('more than 50 participants use pages in the same message', () => {
	const players = Array.from({ length: 101 }, (_, i) => String(2000 + i))
	const first = manager.buildCaptureMessage(
		'now',
		players.slice(0, 20),
		players.slice(20),
		[],
		'test',
		20,
		guild
	)
	const second = manager.buildCaptureMessage(
		'now',
		players.slice(0, 20),
		players.slice(20),
		[],
		'test',
		20,
		guild,
		[],
		[],
		[],
		2
	)
	assert.equal(first.components.length, 4)
	assert.equal(second.components.length, 3)
	assert.equal(
		second.components[2].toJSON().components[0].options[0].value,
		players[100]
	)
})

test('both orders keep confirmed and waiting lists separate and preserve role ties', t => {
	const previous = process.env.PRIORITY_ROLES
	process.env.PRIORITY_ROLES = 'strong,regular'
	t.after(() => {
		if (previous === undefined) delete process.env.PRIORITY_ROLES
		else process.env.PRIORITY_ROLES = previous
	})
	const rankedGuild = { members: { cache: new Map([
		['early', { displayName: 'Early', roles: { cache: new Map([['regular', {}]]) } }],
		['strong1', { displayName: 'Strong 1', roles: { cache: new Map([['strong', {}]]) } }],
		['strong2', { displayName: 'Strong 2', roles: { cache: new Map([['strong', {}]]) } }]
	]) } }
	const build = mode => manager.buildCaptureMessage(
		'now', ['early'], ['strong2', 'strong1'], [], 'test', 1, rankedGuild,
		[{ joinedAt: 1 }], [{ joinedAt: 3 }, { joinedAt: 2 }], ['early'], 0, mode
	)
	const priority = build('priority')
	const text = JSON.stringify(priority.components[0].toJSON())
	assert.match(text, /1\. <@strong1>/)
	assert.match(text, /2\. <@strong2>/)
	assert.match(text, /Подтверждённые \(1\/1\)/)
	assert.match(text, /Ожидание \(2\)/)
	assert.match(text, /1\. <@early>/)
	assert.match(text, /Сортировать по времени/)
	assert.deepEqual(priority.components[2].toJSON().components[0].options.map(o => o.value),
		['strong1', 'strong2', 'early'])
	const time = build('time')
	const timeText = JSON.stringify(time.components[0].toJSON())
	assert.match(timeText, /1\. <@early>/)
	assert.match(timeText, /1\. <@strong1>/)
	assert.match(timeText, /2\. <@strong2>/)
	assert.match(timeText, /Сортировать по приоритету/)
	assert.deepEqual(time.components[2].toJSON().components[0].options.map(o => o.value),
		['early', 'strong1', 'strong2'])
})

test('sort mode persists through joins, approvals, time edits and reloads', async () => {
	row = {
		message_id: 'm', discord_timestamp: 'now', target: 'test', max_main: 20,
		main_list: [ids[0]], reserve_list: [ids[1]], left_list: [],
		main_list_meta: [{ joinedAt: 1 }], reserve_list_meta: [{ joinedAt: 2 }],
		approved_users: [ids[0]], approval_page: 0
	}
	let payload
	const interaction = {
		member: admin, guild, message: { id: 'm' }, user: { id: 'new' },
		customId: 'capt_sort_toggle', isStringSelectMenu: () => false, isButton: () => true,
		deferUpdate: async () => {}, followUp: async value => assert.fail(value.content),
		editReply: async value => { payload = value }
	}
	const before = structuredClone(row)
	await manager.handleApproval(interaction)
	assert.deepEqual(row, { ...before, sort_mode: 'time' })
	assert.match(JSON.stringify(payload.components[0].toJSON()), /Подтверждённые \(1\/20\)/)
	interaction.customId = 'capt_join'
	await manager.handleButton(interaction)
	assert.equal(row.sort_mode, 'time')
	assert.match(JSON.stringify(payload.components[0].toJSON()), /2\. <@new>/)
	interaction.customId = payload.components[2].toJSON().components[0].custom_id
	interaction.isStringSelectMenu = () => true
	interaction.values = [ids[0], ids[1]]
	await manager.handleApproval(interaction)
	assert.equal(row.sort_mode, 'time')
	assert.deepEqual(row.approved_users, [ids[0], ids[1]])
	await manager.updateCollectionTime('m', 'channel', 'later', {
		guilds: { cache: { first: () => guild } },
		channels: { cache: new Map([['channel', { messages: { fetch: async () => ({
			edit: async value => { payload = value }
		}) } }]]) }
	})
	assert.match(JSON.stringify(payload.components[0].toJSON()), /по времени записи/)
	assert.match(JSON.stringify(payload.components[0].toJSON()), /later/)
	delete require.cache[require.resolve('../src/features/capture/captureManager')]
	const reloaded = require('../src/features/capture/captureManager')
	interaction.customId = 'capt_leave'
	await reloaded.handleButton(interaction)
	assert.equal(row.sort_mode, 'time')
	assert.match(JSON.stringify(payload.components[0].toJSON()), /по времени записи/)
	interaction.customId = 'capt_sort_toggle'
	await reloaded.handleApproval(interaction)
	assert.equal(row.sort_mode, 'priority')
	assert.deepEqual(row.approved_users, [ids[0], ids[1]])
	let reply
	await manager.handleApproval({
		customId: 'capt_sort_toggle',
		member: { permissions: { has: () => false }, roles: { cache: new Map() } },
		reply: async value => { reply = value }
	})
	assert.match(reply.content, /нет прав/)
	assert.equal(row.sort_mode, 'priority')
})

test('approval cannot exceed the capture limit across menus', async () => {
	row = {
		message_id: 'm', discord_timestamp: 'now', max_main: 20,
		main_list: ids.slice(0, 20), reserve_list: ids.slice(20), left_list: [],
		main_list_meta: [], reserve_list_meta: [], approved_users: ids.slice(0, 20),
		approval_page: 0, sort_mode: 'time'
	}
	const payload = manager.buildCaptureMessage('now', row.main_list, row.reserve_list,
		[], 'test', 20, guild, [], [], row.approved_users, 0, 'time')
	const before = structuredClone(row)
	let reply
	await manager.handleApproval({
		member: admin, guild, message: { id: 'm' },
		customId: payload.components[3].toJSON().components[0].custom_id,
		values: [ids[29]], isStringSelectMenu: () => true,
		deferUpdate: async () => {}, followUp: async value => { reply = value },
		editReply: async () => assert.fail('must not update the message')
	})
	assert.match(reply.content, /не более 20/)
	assert.deepEqual(row, before)
})


test('manual registration starts in waiting and only admin-approved users enter the limited confirmed list', () => {
	const container = manager.buildCaptureMessage('now', [ids[0], ids[1]], [ids[2]], [], 'тренировка', 2, guild).components[0].toJSON()
	const contents = container.components.filter(component => component.type === 10).map(component => component.content)
	assert.equal(contents.find(text => text.startsWith('### ✅')), '### ✅ Подтверждённые (0/2)\nПусто')
	assert.equal(contents.find(text => text.startsWith('### ⏳')), `### ⏳ Ожидание (3)\n1. <@${ids[0]}>\n2. <@${ids[1]}>\n3. <@${ids[2]}>`)
	const approved = manager.buildCaptureMessage('now', [ids[1]], [ids[0], ids[2]], [], 'тренировка', 2, guild, [], [], [ids[1]]).components[0].toJSON()
	const confirmed = approved.components.find(component => component.type === 10 && component.content.startsWith('### ✅')).content
	const waiting = approved.components.find(component => component.type === 10 && component.content.startsWith('### ⏳')).content
	assert.equal(confirmed, `### ✅ Подтверждённые (1/2)\n1. <@${ids[1]}>`)
	assert.doesNotMatch(waiting, new RegExp(`<@${ids[1]}>`))
})

test('command form forwards the admin target and limit to manual registration and rejects invalid limits', async t => {
	t.mock.method(global, 'setTimeout', () => 0)
	const interactions = require('../src/features/capture/captureInteractions')
	const currentManager = require('../src/features/capture/captureManager')
	const calls = [], replies = []
	t.mock.method(currentManager, 'sendCollection', async (...args) => calls.push(args))
	let count = '2', target = 'Тренировка'
	const interaction = {
		fields: { getTextInputValue: key => ({ capt_time: '18:00', capt_target: target, capt_count: count })[key] },
		reply: async payload => replies.push(payload)
	}
	let modal
	await interactions.showCaptModal({ showModal: async value => { modal = value.toJSON() } })
	assert.equal(modal.components[1].component.required, true)
	assert.equal(modal.components[2].component.custom_id, 'capt_count')
	await interactions.submitCaptModal(interaction)
	assert.equal(calls.length, 1)
	assert.equal(calls[0][0], interaction)
	assert.equal(calls[0][2], 'Тренировка')
	assert.equal(calls[0][3], 2)
	assert.match(calls[0][1], /^<t:\d+:[tF]>$/)
	for (count of ['0', '-1', '1.5', '2abc', '9007199254740992']) {
		await interactions.submitCaptModal(interaction)
		assert.match(replies.at(-1).content, /целым положительным/)
	}
	count = '2'; target = '  '
	await interactions.submitCaptModal(interaction)
	assert.match(replies.at(-1).content, /Укажите цель/)
	assert.equal(calls.length, 1)
})
