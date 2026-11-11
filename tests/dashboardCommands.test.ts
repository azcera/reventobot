import { asMock } from './helpers/moduleStub'
import type { TemplateField } from '../frontend/src/types'
import { moduleStub } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { Collection }: typeof import("discord.js") = require('discord.js')
const { store, catalog }: typeof import("../src/dashboard/store") = require('../src/dashboard/store')
const { memoryPool } = require('./helpers/dashboardFixture')

const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = moduleStub({ id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } })
const invite: typeof import("../src/commands/admin/invite") = require('../src/commands/admin/invite')
const rules: typeof import("../src/commands/admin/rules") = require('../src/commands/admin/rules')
const { getNavigationContainer }: typeof import("../src/commands/admin/navigationBuilder") = require('../src/commands/admin/navigationBuilder')
const { buildContainer }: typeof import("../src/features/invite/inviteUtils") = require('../src/features/invite/inviteUtils')
const { buildCaptureMessage }: typeof import("../src/features/capture/captureManager") = require('../src/features/capture/captureManager')

type CommandPayload = { components: { toJSON(): { accent_color?: number | null } }[]; files: unknown[] }
function components(container: { toJSON(): unknown }) { return JSON.stringify(container.toJSON()) }
function message() {
	let saved!: CommandPayload
	return { member: { permissions: { has: () => true } }, delete: async () => {},
		channel: { get payload() { return saved }, async send(payload: CommandPayload) { saved = payload }, messages: { fetch: async () => new Collection() } } }
}

test('existing command modules pick up edited templates and preserve attachments and action IDs', async () => {
	await store.init(memoryPool())
	const labelKey = Object.keys(catalog).find(key => catalog[key].default === '😎 Подать заявку')
	assert.ok(labelKey)
	await store.save('templates', { [labelKey]: 'Отправить анкету', 'rules.heading.1': '## Правила нашего сервера',
		'invite.color': '#123456', 'navigation.item.1.link': 'https://example.com/rules' }, 0, 'admin')
	const request = message(); await invite.execute(asMock(request), [])
	const payload = request.channel.payload
	assert.match(components(payload.components[0]), /Отправить анкету/)
	assert.match(components(payload.components[0]), /open_invite_modal/)
	assert.equal(payload.files, undefined)
	assert.equal(payload.components[0].toJSON().accent_color ?? null, null)
	await rules.execute(asMock(request), [])
	assert.match(components(request.channel.payload.components[0]), /Правила нашего сервера/)
	assert.equal(request.channel.payload.files, undefined)
	assert.match(components(getNavigationContainer(null, false)), /https:\/\/example.com\/rules/)
})

test('application templates interpolate candidate data without changing moderation button behavior', async () => {
	await store.init(memoryPool())
	await store.save('templates', { 'application.title': '# Новая анкета', 'application.details': '{user}: {name}, {age}\n{about}\n{history}', 'application.1': 'Одобрить' }, 0, 'admin')
	const container = await buildContainer('111', 'Tony | 132961', 18, 'Хочу в семью', 'Revento', 'отправления')
	const json = components(container)
	assert.match(json, /Новая анкета/); assert.match(json, /Tony \| 132961/); assert.match(json, /Хочу в семью/)
	assert.match(json, /invite_accept_111/); assert.match(json, /invite_interview_111/); assert.match(json, /invite_reject_111/)
	assert.match(json, /Одобрить/)
})

test('manual registration refreshes use their own template while participant data and button IDs remain live', async () => {
	await store.init(memoryPool())
	await store.save('templates', { 'registration.document': catalog['registration.document'].default!.replace('## 📢 Рега на {target}!', '# Запись на {target}'), 'capture.title': '# Только API капт {target}' }, 0, 'admin')
	const first = buildCaptureMessage('<t:1:F>', ['111'], [], [], 'капт', 20)
	const second = buildCaptureMessage('<t:1:F>', ['111', '222'], [], [], 'капт', 20)
	assert.ok(store.snapshot().templates.some((field: TemplateField) => field.key === 'registration.document' && field.group === 'Обычная регистрация'))
	assert.match(components(first.components[0]), /Запись на капт/)
	assert.match(components(second.components[0]), /Запись на капт/)
	assert.match(components(second.components[0]), /<@222>/)
	assert.doesNotMatch(components(second.components[0]), /Только API капт/)
	assert.match(components(second.components[1]), /capt_join/)
	assert.match(components(second.components[1]), /capt_leave/)
})
