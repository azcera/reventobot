const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { store, catalog } = require('../src/dashboard/store')
const { memoryPool } = require('./helpers/dashboardFixture')

const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } }
const invite = require('../src/commands/admin/invite')
const rules = require('../src/commands/admin/rules')
const { getNavigationContainer } = require('../src/commands/admin/navigationBuilder')
const { buildContainer } = require('../src/features/invite/inviteUtils')
const { buildCaptureMessage } = require('../src/features/capture/captureManager')

function components(container) { return JSON.stringify(container.toJSON()) }
function message() {
	return { member: { permissions: { has: () => true } }, delete: async () => {},
		channel: { async send(payload) { this.payload = payload }, messages: { fetch: async () => new Collection() } } }
}

test('existing command modules pick up edited templates and preserve attachments and action IDs', async () => {
	await store.init(memoryPool())
	const labelKey = Object.keys(catalog).find(key => catalog[key].default === '😎 Подать заявку')
	await store.save('templates', { [labelKey]: 'Отправить анкету', 'rules.heading.1': '## Правила нашего сервера',
		'invite.color': '#123456', 'navigation.item.1.link': 'https://example.com/rules' }, 0, 'admin')
	const request = message(); await invite.execute(request, [])
	const payload = request.channel.payload
	assert.match(components(payload.components[0]), /Отправить анкету/)
	assert.match(components(payload.components[0]), /open_invite_modal/)
	assert.equal(payload.files.length, 2)
	assert.equal(payload.components[0].toJSON().accent_color, 0x123456)
	await rules.execute(request, [])
	assert.match(components(request.channel.payload.components[0]), /Правила нашего сервера/)
	assert.equal(request.channel.payload.files.length, 1)
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

test('capture refreshes retain customized headers while participant data and button IDs remain live', async () => {
	await store.init(memoryPool())
	await store.save('templates', { 'capture.title': '# Запись на {target}' }, 0, 'admin')
	const first = buildCaptureMessage('<t:1:F>', ['111'], [], [], 'капт', 20)
	const second = buildCaptureMessage('<t:1:F>', ['111', '222'], [], [], 'капт', 20)
	assert.match(components(first.components[0]), /Запись на капт/)
	assert.match(components(second.components[0]), /Запись на капт/)
	assert.match(components(second.components[0]), /<@222>/)
	assert.match(components(second.components[1]), /capt_join/)
	assert.match(components(second.components[1]), /capt_leave/)
})
