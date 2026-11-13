import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, MessageFlags, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js'
import { store } from '../src/dashboard/store'
import { DuplicateCollectionError, publishCollectionOnce } from '../src/features/capture/collectionCreation'

let row: any
let connections = 0
const queries: string[] = []
const claims = new Map<string, { message_url?: string; expires: number }>()
const database = {
	async query(sql: string, values: any[] = []): Promise<{ rows: any[] }> {
		queries.push(sql)
		if (sql.startsWith('INSERT INTO collection_creations')) {
			const existing = claims.get(values[0])
			if (existing && existing.expires > Date.now()) return { rows: [] }
			claims.set(values[0], { expires: values[1].getTime() })
			return { rows: [{ creation_key: values[0] }] }
		}
		if (sql.startsWith('SELECT message_url')) return { rows: [claims.get(values[0])] }
		if (sql.startsWith('UPDATE collection_creations')) {
			claims.get(values[0])!.message_url = values[1]
			claims.get(values[0])!.expires = values[2].getTime()
			return { rows: [] }
		}
		if (sql.startsWith('SELECT * FROM active_captures')) return { rows: row ? [structuredClone(row)] : [] }
		if (sql.startsWith('UPDATE active_captures')) {
			if (sql.includes('SET approved_users')) {
				Object.assign(row, { approved_users: JSON.parse(values[0]), approval_page: values[1], main_list: JSON.parse(values[2]),
					reserve_list: JSON.parse(values[3]), main_list_meta: JSON.parse(values[4]), reserve_list_meta: JSON.parse(values[5]), sort_mode: values[7] })
			} else {
				for (const [index, key] of ['main_list', 'reserve_list', 'left_list', 'main_list_meta', 'reserve_list_meta', 'approved_users'].entries()) row[key] = JSON.parse(values[index])
			}
		}
		return { rows: [] }
	},
	async connect() {
		connections++
		return { query: database.query, release() { connections-- } }
	}
}
const databasePath = require.resolve('../src/services/database')
const previousDatabase = require.cache[databasePath]
require.cache[databasePath] = { exports: database } as NodeModule
const captures = require('../src/features/capture/captureManager') as typeof import('../src/features/capture/captureManager')
const groups = require('../src/features/capture/groupInteractions') as typeof import('../src/features/capture/groupInteractions')
if (previousDatabase) require.cache[databasePath] = previousDatabase
else delete require.cache[databasePath]

function reset(main: string[] = [], reserve: string[] = []) {
	queries.length = 0
	connections = 0
	claims.clear()
	row = { discord_timestamp: `<t:${Math.floor(Date.now() / 1000) + 1800}:F>`, target: 'Тест', max_main: 1,
		main_list: main, reserve_list: reserve, left_list: [], approved_users: [], main_list_meta: main.map((userId, i) => ({ userId, joinedAt: i })),
		reserve_list_meta: reserve.map((userId, i) => ({ userId, joinedAt: i + main.length })), sort_mode: 'time' }
}

function fixture(userId: string, customId = 'capt_join') {
	const replies: any[] = [], edits: any[] = [], dms: string[] = []
	const interaction = {
		customId, user: { id: userId }, message: { id: 'message', url: 'https://discord.com/channels/guild/channel/message' },
		guild: { id: 'guild', members: { cache: new Collection() } }, member: { permissions: { has: () => true } },
		client: { users: { fetch: async (id: string) => ({ send: async () => { dms.push(id) } }) } },
		isButton: () => true, isStringSelectMenu: () => false, deferUpdate: async () => {},
		followUp: async (payload: any) => { replies.push(payload) },
		editReply: async (payload: any) => { assert.equal(connections, 0); edits.push(payload) }
	}
	return { interaction: interaction as unknown as ButtonInteraction<'cached'>, replies, edits, dms }
}

test('creation claim blocks concurrent and repeated publication, returns the existing link and survives a failed send', async () => {
	reset()
	let release!: () => void
	const pending = new Promise<void>(resolve => { release = resolve })
	let sends = 0
	const publish = async () => { sends++; await pending; return 'https://discord.com/message' }
	const first = publishCollectionOnce(database as any, ['same'], Date.now() + 3600000, publish)
	await assert.rejects(publishCollectionOnce(database as any, ['same'], Date.now() + 3600000, publish), DuplicateCollectionError)
	release()
	await first
	await assert.rejects(publishCollectionOnce(database as any, ['same'], Date.now() + 3600000, publish), /https:\/\/discord.com\/message/)
	assert.equal(sends, 1)
	await assert.rejects(publishCollectionOnce(database as any, ['uncertain'], Date.now() + 3600000, async () => { throw new Error('timeout') }), /timeout/)
	await assert.rejects(publishCollectionOnce(database as any, ['uncertain'], Date.now() + 3600000, publish), DuplicateCollectionError)
	// Expired claims can be used again; different channels/events do not collide.
	for (const claim of claims.values()) claim.expires = 0
	await publishCollectionOnce(database as any, ['same'], Date.now() + 3600000, publish)
	await publishCollectionOnce(database as any, ['different'], Date.now() + 3600000, publish)
	assert.equal(sends, 3)
})

test('joining confirms main/reserve privately after commit, leaving promotes and notifies the reserve', async () => {
	reset()
	const first = fixture('first')
	await captures.handleButton(first.interaction)
	assert.match(first.replies[0].content, /основной состав/)
	assert.equal(first.replies[0].flags, MessageFlags.Ephemeral)
	const second = fixture('second')
	await captures.handleButton(second.interaction)
	assert.match(second.replies[0].content, /резерв.*1/)
	const leaving = fixture('first', 'capt_leave')
	await captures.handleButton(leaving.interaction)
	assert.deepEqual(row.main_list, ['second'])
	assert.deepEqual(leaving.dms, ['second'])
	assert.match(leaving.replies[0].content, /отменили/)
	assert.equal(queries.filter(sql => sql === 'COMMIT').length, 3)
})

test('slow Discord edits do not hold DB connections or block new joins; final edit uses current state', async () => {
	reset()
	const first = fixture('first')
	let started!: () => void, release!: () => void
	const editing = new Promise<void>(resolve => { started = resolve })
	const waiting = new Promise<void>(resolve => { release = resolve })
	first.interaction.editReply = (async (payload: any) => { assert.equal(connections, 0); first.edits.push(payload); started(); await waiting }) as any
	const one = captures.handleButton(first.interaction)
	await editing
	const second = fixture('second')
	const two = captures.handleButton(second.interaction)
	await new Promise(resolve => setImmediate(resolve))
	assert.deepEqual(row.reserve_list, ['second'])
	assert.match(second.replies[0].content, /резерв/)
	assert.equal(second.edits.length, 0)
	const third = fixture('third')
	const three = captures.handleButton(third.interaction)
	await new Promise(resolve => setImmediate(resolve))
	assert.deepEqual(row.reserve_list, ['second', 'third'])
	release()
	await Promise.all([one, two, three])
	assert.equal(first.edits.length, 2)
	assert.match(JSON.stringify(first.edits[1]), /second/)
	assert.match(JSON.stringify(first.edits[1]), /third/)
})

test('failed Discord refresh and closed DMs never roll back a committed promotion', async t => {
	t.mock.method(console, 'error', () => {})
	reset(['first'], ['second'])
	const f = fixture('first', 'capt_leave')
	let attempts = 0
	f.interaction.editReply = (async () => { attempts++; throw new Error('Discord unavailable') }) as any
	f.interaction.client.users.fetch = (async () => { throw new Error('DM closed') }) as any
	await captures.handleButton(f.interaction)
	assert.deepEqual(row.main_list, ['second'])
	assert.equal(attempts, 2)
	assert.equal(queries.includes('ROLLBACK'), false)
	assert.ok(f.replies.some(reply => /Запись сохранена/.test(reply.content)))
})

test('manual approval also notifies users promoted from reserve, after releasing the transaction', async () => {
	reset(['first'], ['second'])
	const f = fixture('admin')
	const payload = JSON.parse(JSON.stringify(captures.buildCaptureMessage(row.discord_timestamp, row.main_list, row.reserve_list, [], row.target, 1,
		f.interaction.guild, row.main_list_meta, row.reserve_list_meta, [], 0, 'time')))
	const menu = payload.components.flatMap((component: any) => component.components || []).find((component: any) => component.custom_id?.startsWith('capt_approve_'))
	Object.assign(f.interaction, { customId: menu.custom_id, values: ['second'], isStringSelectMenu: () => true })
	await captures.handleApproval(f.interaction as unknown as StringSelectMenuInteraction<'cached'>)
	assert.deepEqual(row.main_list, ['second'])
	assert.deepEqual(f.dms, ['second'])
})

test('group success follows publication, duplicates do not ping again, unavailable channels never report success', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	t.mock.method(console, 'error', () => {})
	t.mock.method(store, 'getSetting', () => 'ping')
	reset()
	const replies: string[] = []
	let sends = 0
	const channel = { isSendable: () => true, async send() { assert.equal(replies.length, 0); sends++; return { url: 'https://discord.com/group' } } }
	const interaction = { guildId: 'guild', customId: 'modal_group_schedule_supply', member: {}, deferred: true,
		deferReply: async () => {}, editReply: async (payload: any) => { replies.push(payload.content) }, deleteReply: async () => {},
		fields: { getTextInputValue: () => '' },
		client: { channels: { cache: new Collection([['ping', channel]]) }, eventSchedule: { canCreateGroup: () => true,
			resolveSelection: () => ({ label: 'Поставки', groupKind: 'supply' }) } } } as unknown as ModalSubmitInteraction<'cached'>
	await groups.submitGroupModal(interaction)
	assert.match(replies[0], /Группа создана.*\nhttps:\/\/discord.com\/group/s)
	assert.equal(sends, 3)
	await groups.submitGroupModal(interaction)
	assert.match(replies[1], /уже создан/)
	assert.equal(sends, 3)
	claims.clear(); replies.length = 0
	channel.send = async () => { throw new Error('timeout') }
	await groups.submitGroupModal(interaction)
	assert.doesNotMatch(replies[0], /✅/)
	assert.match(replies[0], /Не удалось подтвердить/)
	replies.length = 0
	channel.isSendable = () => false
	await groups.submitGroupModal(interaction)
	assert.match(replies[0], /не опубликована/)
})

test('collection creation saves before reminders, rejects duplicates and propagates persistence errors', async t => {
	reset()
	let sends = 0
	const channel = { id: 'channel', isSendable: () => true, async send() { sends++; return { id: 'message', url: 'https://discord.com/collection' } } }
	const interaction = { guild: { id: 'guild', channels: { fetch: async () => channel } } } as unknown as ModalSubmitInteraction<'cached'>
	assert.equal(await captures.sendCollection(interaction, row.discord_timestamp, 'Цель', 20, true, 'channel'), 'https://discord.com/collection')
	assert.equal(sends, 4)
	await assert.rejects(captures.sendCollection(interaction, row.discord_timestamp, ' цель ', 30, true, 'channel'), DuplicateCollectionError)
	assert.equal(sends, 4)
	const query = database.query.bind(database)
	t.mock.method(database, 'query', async (sql: string, values: any[] = []) => {
		if (sql.startsWith('INSERT INTO active_captures')) throw new Error('database unavailable')
		return query(sql, values)
	})
	await assert.rejects(captures.sendCollection(interaction, row.discord_timestamp, 'Другая цель', 20, true, 'channel'), /database unavailable/)
	assert.equal(sends, 5) // The failed creation sends no reminders and cannot be published twice.
	await assert.rejects(captures.sendCollection(interaction, row.discord_timestamp, 'Другая цель', 20, true, 'channel'), DuplicateCollectionError)
	assert.equal(sends, 5)
})
