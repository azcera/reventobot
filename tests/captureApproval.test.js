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
	exports: { connect: async () => client }
}
const manager = require('../src/features/capture/captureManager')
const guild = { members: { cache: new Map() } }
const admin = { permissions: { has: () => true }, roles: { cache: new Map() } }
const ids = Array.from({ length: 30 }, (_, i) => String(1000 + i))

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

test('more than 100 participants use pages in the same message', () => {
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
		1
	)
	assert.equal(first.components.length, 6)
	assert.equal(second.components.length, 3)
	assert.equal(
		second.components[2].toJSON().components[0].options[0].value,
		players[100]
	)
})
