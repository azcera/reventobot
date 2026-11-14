import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, MessageFlags, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js'
import { store } from '../src/dashboard/store'

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
const { handleCapturePanel } = require('../src/features/capture/captureApprovalPanel') as typeof import('../src/features/capture/captureApprovalPanel')
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
		customId, channelId: 'channel', user: { id: userId }, message: { id: 'message', url: 'https://discord.com/channels/guild/channel/message' },
		guild: { id: 'guild', members: { cache: new Collection() } }, member: { permissions: { has: () => true } },
		client: { users: { fetch: async (id: string) => ({ send: async () => { dms.push(id) } }) } },
		isButton: () => true, isStringSelectMenu: () => false, deferUpdate: async () => {}, deferReply: async () => {},
		reply: async (payload: any) => { replies.push(payload) },
		channel: { messages: { fetch: async (id: string) => ({ id, url: 'https://discord.com/channels/guild/channel/message', edit: async (payload: any) => { assert.equal(connections, 0); edits.push(payload) } }) } },
		followUp: async (payload: any) => { replies.push(payload) },
		editReply: async (payload: any) => { assert.equal(connections, 0); edits.push(payload) }
	}
	return { interaction: interaction as unknown as ButtonInteraction<'cached'>, replies, edits, dms }
}

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

function panelComponents(f: ReturnType<typeof fixture>) {
	return JSON.parse(JSON.stringify(f.edits.at(-1))).components[0].components.flatMap((c: any) => c.components || [])
}

async function openPanel(userId = 'admin') {
	const f = fixture(userId, 'capt_manage')
	await handleCapturePanel(f.interaction)
	const control = panelComponents(f).find((c: any) => c.custom_id?.endsWith('_refresh'))
	return { f, prefix: control.custom_id.slice(0, -'refresh'.length) as string }
}

async function panelAction(panel: Awaited<ReturnType<typeof openPanel>>, action: string, values?: string[]) {
	Object.assign(panel.f.interaction, { customId: panel.prefix + action, values: values || [], isStringSelectMenu: () => values !== undefined })
	await handleCapturePanel(panel.f.interaction)
}

test('manual panel approval notifies promoted users after releasing the transaction', async () => {
	reset(['first'], ['second'])
	const panel = await openPanel()
	await panelAction(panel, 'add:second')
	assert.deepEqual(row.main_list, ['second'])
	assert.deepEqual(panel.f.dms, ['second'])
	assert.equal(queries.includes('BEGIN'), true)
	assert.ok(queries.some(sql => sql.endsWith('FOR UPDATE')))
})

test('batch approval survives new joins and skips departed players without losing other selections', async () => {
	reset(['first'], ['second', 'third'])
	row.max_main = 3
	const panel = await openPanel()
	await panelAction(panel, 'select', ['first', 'second', 'third'])
	await captures.handleButton(fixture('new').interaction)
	await captures.handleButton(fixture('second', 'capt_leave').interaction)
	await panelAction(panel, 'add')
	assert.deepEqual(row.approved_users, ['first', 'third'])
	assert.ok(row.reserve_list.includes('new'))
	assert.match(JSON.stringify(panel.f.edits.at(-1)), /Вышли: 1/)
	assert.equal(panelComponents(panel.f).some((c: any) => c.options?.some((o: any) => o.value === 'new')), false)
	await panelAction(panel, 'refresh')
	assert.equal(panelComponents(panel.f).some((c: any) => c.options?.some((o: any) => o.value === 'new')), true)
})

test('independent administrator panels preserve approvals, enforce capacity and remove only requested players', async () => {
	reset(['first'], ['second', 'third'])
	row.max_main = 2
	const one = await openPanel('admin1')
	const two = await openPanel('admin2')
	await panelAction(one, 'add:first')
	await panelAction(two, 'select', ['first', 'second', 'third'])
	await panelAction(two, 'add')
	assert.deepEqual(row.approved_users, ['first', 'second'])
	assert.match(JSON.stringify(two.f.edits.at(-1)), /Не хватило мест: 1/)
	await panelAction(one, 'add:first')
	assert.deepEqual(row.approved_users, ['first', 'second'])
	await panelAction(one, 'remove:first')
	assert.deepEqual(row.approved_users, ['second'])
})

test('simultaneous administrator confirmations read the latest state under the row lock', async t => {
	reset(['first'], ['second'])
	const one = await openPanel('admin1')
	const two = await openPanel('admin2')
	let tail = Promise.resolve()
	t.mock.method(database, 'connect', async () => {
		connections++
		let unlock: (() => void) | undefined
		return {
			async query(sql: string, values?: any[]) {
				if (sql.endsWith('FOR UPDATE')) {
					const previous = tail
					tail = new Promise<void>(resolve => { unlock = resolve })
					await previous
				}
				const result = await database.query(sql, values)
				if (sql === 'COMMIT' || sql === 'ROLLBACK') unlock?.()
				return result
			},
			release() { connections--; unlock?.() }
		}
	})
	await Promise.all([panelAction(one, 'add:first'), panelAction(two, 'add:second')])
	assert.deepEqual(row.approved_users, ['first'])
	assert.match(JSON.stringify(two.f.edits.at(-1)), /Не хватило мест: 1/)
	assert.equal(connections, 0)
})

test('public refresh failure preserves committed batch changes and the private panel', async t => {
	t.mock.method(console, 'error', () => {})
	reset(['first'], ['second'])
	const panel = await openPanel()
	Object.assign(panel.f.interaction, { channel: { messages: { fetch: async () => { throw new Error('Discord unavailable') } } } })
	await panelAction(panel, 'select', ['second'])
	await panelAction(panel, 'add')
	assert.deepEqual(row.approved_users, ['second'])
	assert.match(panel.f.replies.at(-1).content, /Изменения сохранены/)
	assert.match(JSON.stringify(panel.f.edits.at(-1)), /Изменено: 1/)
	assert.equal(queries.includes('ROLLBACK'), false)
})

test('panel pages are private snapshots; navigation clears selection and never changes the public page', async () => {
	reset(['first'], ['second', 'third', 'fourth', 'fifth', 'sixth'])
	const panel = await openPanel()
	await panelAction(panel, 'select', ['first'])
	await panelAction(panel, 'next')
	const menu = panelComponents(panel.f).find((c: any) => c.options)
	assert.deepEqual(menu.options.map((o: any) => o.value), ['sixth'])
	await panelAction(panel, 'add')
	assert.deepEqual(row.approved_users, [])
	assert.equal(row.approval_page, 0)
	assert.equal(panelComponents(panel.f).filter((c: any) => c.options).length, 1)
})

test('panel checks permissions, owner, expiry and current registration deadline', async t => {
	reset(['first'])
	const denied = fixture('user', 'capt_manage')
	Object.assign(denied.interaction.member, { permissions: { has: () => false } })
	Object.assign(denied.interaction.member, { roles: { cache: new Collection() } })
	await handleCapturePanel(denied.interaction)
	assert.match(denied.replies[0].content, /нет прав/)
	const panel = await openPanel()
	const other = fixture('other', panel.prefix + 'add:first')
	await handleCapturePanel(other.interaction)
	assert.match(other.replies[0].content, /устарела/)
	row.discord_timestamp = `<t:${Math.floor(Date.now() / 1000) - 3601}:F>`
	await panelAction(panel, 'add:first')
	assert.deepEqual(row.approved_users, [])
	assert.match(JSON.stringify(panel.f.edits.at(-1)), /Сбор завершён/)
	t.mock.method(Date, 'now', () => new Date().getTime() + 16 * 60_000)
	await panelAction(panel, 'refresh')
	assert.match(panel.f.replies.at(-1).content, /устарела/)
})

test('public registration exposes management instead of approval menus; legacy menus open a panel', async () => {
	reset(['first'])
	const payload = JSON.stringify(captures.buildCaptureMessage(row.discord_timestamp, ['first'], [], [], 'Тест', 1))
	assert.match(payload, /capt_manage/)
	assert.doesNotMatch(payload, /capt_approve_/)
	const legacy = fixture('admin', 'capt_approve_oldhash')
	await handleCapturePanel(legacy.interaction)
	assert.ok(panelComponents(legacy).some((c: any) => c.custom_id?.endsWith('_add:first')))
})

test('group success follows publication, repeated creation sends again, unavailable channels never report success', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	t.mock.method(console, 'error', () => {})
	t.mock.method(store, 'getSetting', () => 'ping')
	reset()
	const replies: string[] = []
	let sends = 0
	const channel = { isSendable: () => true, async send() { assert.equal(replies.length, Math.floor(sends / 3)); sends++; return { url: 'https://discord.com/group' } } }
	const interaction = { guildId: 'guild', customId: 'modal_group_schedule_supply', member: {}, deferred: true,
		deferReply: async () => {}, editReply: async (payload: any) => { replies.push(payload.content) }, deleteReply: async () => {},
		fields: { getTextInputValue: () => '' },
		client: { channels: { cache: new Collection([['ping', channel]]) }, eventSchedule: { canCreateGroup: () => true,
			resolveSelection: () => ({ label: 'Поставки', groupKind: 'supply' }) } } } as unknown as ModalSubmitInteraction<'cached'>
	await groups.submitGroupModal(interaction)
	assert.match(replies[0], /Группа создана.*\nhttps:\/\/discord.com\/group/s)
	assert.equal(sends, 3)
	await groups.submitGroupModal(interaction)
	assert.match(replies[1], /Группа создана/)
	assert.equal(sends, 6)
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

test('collection creation saves before reminders, allows repeats and propagates persistence errors', async t => {
	reset()
	let sends = 0
	const channel = { id: 'channel', isSendable: () => true, async send() { sends++; return { id: 'message', url: 'https://discord.com/collection' } } }
	const interaction = { guild: { id: 'guild', channels: { fetch: async () => channel } } } as unknown as ModalSubmitInteraction<'cached'>
	assert.equal(await captures.sendCollection(interaction, row.discord_timestamp, 'Цель', 20, true, 'channel'), 'https://discord.com/collection')
	assert.equal(sends, 4)
	assert.equal(await captures.sendCollection(interaction, row.discord_timestamp, ' цель ', 30, true, 'channel'), 'https://discord.com/collection')
	assert.equal(sends, 8)
	const query = database.query.bind(database)
	t.mock.method(database, 'query', async (sql: string, values: any[] = []) => {
		if (sql.startsWith('INSERT INTO active_captures')) throw new Error('database unavailable')
		return query(sql, values)
	})
	await assert.rejects(captures.sendCollection(interaction, row.discord_timestamp, 'Другая цель', 20, true, 'channel'), /database unavailable/)
	assert.equal(sends, 9) // The failed creation sends no reminders.
	await assert.rejects(captures.sendCollection(interaction, row.discord_timestamp, 'Другая цель', 20, true, 'channel'), /database unavailable/)
	assert.equal(sends, 10)
})
