import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, type Client, type Guild, type ModalSubmitInteraction, type ButtonInteraction } from 'discord.js'
import type { Pool } from 'pg'
import { store } from '../src/dashboard/store'
import { parseDisplayName } from '../src/utils/parseDisplayName'
import { buildPreview, parseNickname } from '../src/features/majestic/syncPreview'
import { syncRolePrefixes } from '../src/services/rolePrefixSync'
import { attackEventAt, buildSchedule, createEventSchedule, getSchedule } from '../src/services/eventSchedule'
import { showScheduledGroupModal, submitGroupModal } from '../src/features/capture/groupInteractions'
import { captureExpired } from '../src/features/capture/captureExpiry'
import { createCaptureExpiry, disableCaptureControls } from '../src/services/captureExpiry'
import { validateSettings, validateTemplates } from '../src/dashboard/routes'

const databasePath = require.resolve('../src/services/database')
const previousDatabase = require.cache[databasePath]
const queries: string[] = []
let databaseRow: Record<string, unknown> | undefined
require.cache[databasePath] = { exports: {
	async query(sql: string) { queries.push(sql); return { rows: databaseRow ? [databaseRow] : [] } },
	async connect() { return { async query(sql: string) { queries.push(sql); return { rows: databaseRow ? [databaseRow] : [] } }, release() {} } }
} } as NodeModule
const captures = require('../src/features/capture/captureManager') as typeof import('../src/features/capture/captureManager')
const edits = require('../src/features/capture/captureInteractions') as typeof import('../src/features/capture/captureInteractions')
const invite = require('../src/features/invite/inviteApplication') as typeof import('../src/features/invite/inviteApplication')
if (previousDatabase) require.cache[databasePath] = previousDatabase
else delete require.cache[databasePath]

const now = Date.parse('2026-11-13T16:00:00+03:00')
const timestamp = (ms: number) => `<t:${Math.floor(ms / 1000)}:F>`

test('all ordinary collection sources disable controls at exactly one hour; late join and time edits are rejected', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	assert.equal(captureExpired(timestamp(now), now + 3599999), false)
	assert.equal(captureExpired(timestamp(now), now + 3600000), true)
	const expired = timestamp(Date.now() - 3600001)
	const payload = captures.buildCaptureMessage(expired, [], [], [], 'Поставки', 20)
	const buttons = JSON.parse(JSON.stringify(payload)).components[1].components
	assert.equal(buttons.filter((button: any) => button.disabled).length, 3)
	databaseRow = { discord_timestamp: expired }
	queries.length = 0
	const responses: string[] = []
	await captures.handleButton({ isButton: () => true, customId: 'capt_join', message: { id: 'message' }, user: { id: 'user' },
		deferUpdate: async () => {}, followUp: async (value: any) => { responses.push(value.content) }
	} as unknown as ButtonInteraction<'cached'>)
	assert.match(responses[0], /прошёл час/)
	assert.equal(queries.some(sql => sql.startsWith('UPDATE')), false)
	databaseRow = undefined // The conditional UPDATE must reject an expired collection.
	await edits.submitInlineEditTimeModal({ member: { permissions: { has: () => true }, roles: { cache: new Collection() } },
		customId: 'modal_inline_edit_time_message', channelId: 'channel', fields: { getTextInputValue: () => '18:00' },
		deferReply: async () => {}, editReply: async (value: any) => { responses.push(value.content) }
	} as unknown as ModalSubmitInteraction<'cached'>)
	assert.match(responses[1], /завершён/)
})

test('time edit modal opens without waiting for the database', async () => {
	queries.length = 0
	let opened = false
	await edits.handleInlineEditTimeButton({ member: { permissions: { has: () => true }, roles: { cache: new Collection() } }, message: { id: 'message' },
		showModal: async () => { opened = true }
	} as unknown as ButtonInteraction<'cached'>)
	assert.equal(opened, true)
	assert.deepEqual(queries, [])
})

test('group and capture submissions await acknowledgement before reading fields or performing work', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	for (const submit of [submitGroupModal, edits.submitCaptModal]) {
		let release!: () => void
		let read = false
		const responses: string[] = []
		const interaction = {
			customId: 'modal_group_other', deferred: false,
			async deferReply(this: { deferred: boolean }) { await new Promise<void>(resolve => { release = resolve }); this.deferred = true },
			fields: { getTextInputValue() { read = true; return 'invalid' } },
			async editReply(payload: { content: string }) { responses.push(payload.content) }
		} as unknown as ModalSubmitInteraction<'cached'>
		const pending = submit(interaction)
		assert.equal(read, false)
		release()
		await pending
		assert.equal(read, true)
		assert.match(responses[0], /Неверный формат времени/)
		read = false
		interaction.deferReply = async () => { throw new Error('Acknowledgement failed') }
		await assert.rejects(submit(interaction), /Acknowledgement failed/)
		assert.equal(read, false)
	}
})

test('closure worker recovers stored collections after restart and rechecks moved times under a lock', async () => {
	const row = { message_id: 'message', channel_id: 'channel', discord_timestamp: timestamp(Date.now() - 3600001), controls_closed: false }
	let edits = 0, updates = 0
	const connection = { async query(sql: string) {
		if (sql.startsWith('UPDATE')) updates++
		return { rows: sql.startsWith('SELECT') ? [row] : [] }
	}, release() {} }
	const client = { channels: { fetch: async () => ({ messages: { fetch: async () => ({ components: [{ type: 1, components: [{ type: 2, custom_id: 'capt_join' }] }],
		edit: async (payload: any) => { assert.equal(payload.components[0].components[0].disabled, true); edits++ }
	}) } }) } } as unknown as Client
	const pool = { query: async () => ({ rows: [{ ...row, discord_timestamp: timestamp(Date.now() - 3600001) }] }), connect: async () => connection } as unknown as Pool
	const service = createCaptureExpiry({ client, pool, store })
	await service.tick()
	assert.equal(edits, 1); assert.equal(updates, 1)
	row.discord_timestamp = timestamp(Date.now() + 3600000)
	await service.tick()
	assert.equal(edits, 1); assert.equal(updates, 1)
	assert.deepEqual(disableCaptureControls([{ type: 2, custom_id: 'unrelated' }]), [{ type: 2, custom_id: 'unrelated' }])
})

test('arbitrary dashboard tags are accepted, parsed and replaced without stacking', async () => {
	const roleId = '123456789012345678'
	const prefixes = [{ roleId, prefix: 'TAG >' }]
	const guild = { id: 'guild', roles: { cache: new Collection([[roleId, {}]]) } } as unknown as Guild
	await validateSettings({ ROLE_PREFIXES: prefixes }, guild)
	for (const prefix of ['bad|tag', 'bad\ntag', ' ']) await assert.rejects(validateSettings({ ROLE_PREFIXES: [{ roleId, prefix }] }, guild))
	assert.deepEqual(parseDisplayName('TAG > Tony | 123 / inactive', prefixes), { memberName: 'Tony', memberStatic: '123' })
	assert.equal(parseNickname('TAG > Tony | 123 / inactive', prefixes)?.prefix, 'TAG > ')
	let changed = ''
	const member = { displayName: 'OLD :: Tony | 123 / inactive', manageable: true, roles: { cache: new Collection([[roleId, {}]]) },
		setNickname: async (name: string) => { changed = name } }
	const members = new Collection([['user', member]])
	const result = await syncRolePrefixes({ members: { fetch: async () => members } } as unknown as Guild, prefixes)
	assert.equal(result.updated, 1); assert.equal(changed, 'TAG > Tony | 123 / inactive')
	const preview = buildPreview([{ id: 123, login: 'Tony Surname', rankName: 'Leader' } as any],
		[{ id: 'user', nickname: '[Old] Tony | 123', bot: false, roleIds: [roleId] }], { rolePrefixes: prefixes, nicknamesOnly: true })
	assert.equal(preview[0].nickname, 'TAG > Tony | 123')
})

test('attack windows use Moscow weekdays and exclude 19–20 and times outside 16–23', () => {
	for (const [day, id] of [[9, 'fz'], [10, 'island'], [11, 'fz'], [12, 'island'], [13, 'fz'], [14, 'fz'], [15, 'island']] as const) {
		for (const [time, allowed] of [['15:59', false], ['16:00', true], ['18:59', true], ['19:00', false], ['19:59', false], ['20:00', true], ['22:59', true], ['23:00', false]] as const) {
			assert.equal(attackEventAt(Date.parse(`2026-11-${String(day).padStart(2, '0')}T${time}:00+03:00`))?.id ?? null, allowed ? id : null)
		}
	}
})

test('schedule buttons have icons, optional codes and event-specific fields; groups share one editable template', async t => {
	t.mock.method(Date, 'now', () => now)
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const schedule = createEventSchedule({ client: {} as Client, pool: {} as Pool, store, now: () => now })
	const getSetting = store.getSetting.bind(store)
	t.mock.method(store, 'getSetting', (key: string) => key === 'PING_CHANNEL_ID' ? 'ping' : getSetting(key))
	let modal: any
	const member = { permissions: { has: () => true } }
	const sent: string[] = []
	const interaction = { customId: 'schedule_group_supply', member, client: { eventSchedule: schedule,
		channels: { cache: new Collection([['ping', { isSendable: () => true, send: async (content: string) => { sent.push(content) } }]]) } },
		showModal: async (value: any) => { modal = value.toJSON() }, reply: async () => {}, deleteReply: async () => {},
		async deferReply() { (this as { deferred?: boolean }).deferred = true }, editReply: async () => {} }
	await showScheduledGroupModal(interaction as unknown as ButtonInteraction<'cached'>)
	assert.deepEqual(modal.components.map((label: any) => label.component.custom_id), ['group_code'])
	assert.equal(modal.components[0].component.required, false)
	await submitGroupModal({ ...interaction, customId: 'modal_group_schedule_supply', fields: { getTextInputValue: () => '' } } as unknown as ModalSubmitInteraction<'cached'>)
	assert.equal(sent.length, 3); assert.doesNotMatch(sent[0], /проверка явки|Код группы|\d\d:\d\d/)
	interaction.customId = 'schedule_group_fz'
	await showScheduledGroupModal(interaction as unknown as ButtonInteraction<'cached'>)
	assert.deepEqual(modal.components.map((label: any) => label.component.custom_id), ['group_time', 'group_code'])
	await submitGroupModal({ ...interaction, customId: 'modal_group_schedule_fz', fields: { getTextInputValue: (key: string) => key === 'group_time' ? '16:30' : '' } } as unknown as ModalSubmitInteraction<'cached'>)
	assert.match(sent[3], /в `16:25`, проверка явки в `16:30`/)
	const field = store.snapshot().templates.find(field => field.key === 'group.message')!
	assert.ok(field); assert.doesNotThrow(() => validateTemplates({ 'group.message': field.value }))
	const payload = JSON.stringify(buildSchedule(getSchedule(now).events, now, false, now))
	for (const id of ['supply', 'fz']) assert.match(payload, new RegExp(`schedule_group_${id}`))
	assert.doesNotMatch(payload, /schedule_group_island/)
	assert.match(payload, /Нападение разрешено/)
	assert.match(payload, /"emoji"/)
	assert.equal(schedule.resolveSelection('island'), null)
})

test('application nickname is capitalized with the remaining letters in lowercase', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	databaseRow = undefined
	let nickname = ''
	const fields: Record<string, string> = { invite_name: 'tONy', invite_static: '123', invite_age: '20', invite_info: 'test', invite_history: 'test' }
	const channel = { id: 'application', send: async () => {} }
	await invite.submitModal({ fields: { getTextInputValue: (key: string) => fields[key] }, user: { id: 'user' },
		member: { setNickname: async (name: string) => { nickname = name } },
		guild: { id: 'guild', channels: { create: async () => channel } },
		deferReply: async () => {}, editReply: async () => {}, deleteReply: async () => {}
	} as unknown as ModalSubmitInteraction<'cached'>)
	assert.equal(nickname, 'Tony | 123')
})
