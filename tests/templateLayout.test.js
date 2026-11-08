const { test } = require('node:test')
const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { store, createStore, catalog } = require('../src/dashboard/store')
const { createFixture, memoryPool } = require('./helpers/dashboardFixture')
const { validateTemplates } = require('../src/dashboard/routes')
const markdown = require('../public/component-markdown')

const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } }

test('editable catalog exposes documents and state fields, excluding obsolete and fixed templates', () => {
	const fields = createStore().snapshot().templates
	assert.ok(fields.some(field => field.key === 'invite.document'))
	assert.ok(fields.some(field => field.key === 'navigation.document'))
	assert.equal(fields.filter(field => field.key.startsWith('application.document.')).length, 4)
	assert.equal(fields.filter(field => field.key.startsWith('dm.document.')).length, 3)
	assert.ok(fields.every(field => !/^(panel|archives|unanswered)\./.test(field.key)))
	assert.equal(existsSync(require('node:path').join(__dirname, '../src/commands/admin/panel.js')), false)
	for (const key of ['archives.1', 'unanswered.empty', 'panel.2']) assert.throws(() => validateTemplates({ [key]: 'Изменено' }), /Неизвестный/)
	const navigation = markdown.parse(fields.find(field => field.key === 'navigation.document').value)
	assert.ok(navigation.some(item => item.type === 'text' && item.value === '## Основное'))
	assert.equal(navigation.filter(item => item.type === 'section').length, 7)
})

test('legacy customizations become documents, survive restart, and reset to original defaults', async () => {
	const pool = memoryPool(), local = createStore()
	await local.init(pool)
	await local.save('templates', { 'invite.5': '## Сохранённое приглашение', 'application.title': '# Моя заявка', 'archives.1': 'Старый заголовок' }, local.revision, 'admin')
	assert.match(local.text('invite.document'), /Сохранённое приглашение/)
	assert.match(local.text('application.document.pending'), /Моя заявка/)
	assert.equal(local.text('archives.1'), catalog['archives.1'].default)
	await local.save('templates', { 'invite.document': '# Целый документ\n---\nНовый текст' }, local.revision, 'admin')
	const restarted = createStore(); await restarted.init(pool)
	assert.equal(restarted.text('invite.document'), '# Целый документ\n---\nНовый текст')
	await restarted.save('templates', { 'invite.document': null }, restarted.revision, 'admin')
	assert.doesNotMatch(restarted.text('invite.document'), /Сохранённое приглашение|Целый документ/)
})

test('saved documents drive Discord invitation, navigation and every application state', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const values = { 'invite.document': '# Приглашение\n---\n<img src="attachment://invites.png" />', 'invite.3': 'Оставить заявку на вступление', 'invite.4': 'Заполнить анкету', 'navigation.document': '# Основное\n***\n<section buttonLabel="Правила" buttonLink="https://example.com/rules">Описание правил</section>' }
	for (const state of ['pending', 'accepted', 'rejected', 'interview']) values['application.document.' + state] = store.text('application.document.' + state).replace('# ', '# Изменено ')
	const response = await f.request('/api/templates', { body: { revision: store.revision, values } })
	assert.equal(response.status, 200, JSON.stringify(await response.json()))
	const invite = (await require('../src/commands/admin/invite').buildPayload()).components[0].toJSON().components
	assert.deepEqual(invite.map(component => component.type), [10, 14, 12, 14, 9])
	assert.equal(invite.at(-1).components[0].content, 'Оставить заявку на вступление')
	assert.equal(invite.at(-1).accessory.label, 'Заполнить анкету')
	assert.equal(invite.at(-1).accessory.custom_id, 'open_invite_modal')
	const navigation = require('../src/commands/admin/navigationBuilder').getNavigationContainer(null, false).toJSON().components
	assert.deepEqual(navigation.map(component => component.type), [10, 14, 9])
	assert.equal(navigation[1].spacing, 2)
	for (const action of ['отправления', 'принятия', 'отклонения', 'обзвона']) {
		const container = await require('../src/features/invite/inviteUtils').buildContainer('111', 'Tony', '18', 'О себе', 'История', action, '222', '333')
		const json = JSON.stringify(container.toJSON())
		assert.match(json, /Изменено/)
		assert.match(json, /Tony/)
		assert.doesNotMatch(json, /\{(?:user|name|time|admin)\}/)
	}
})

test('existing recruit and promotion bindings upgrade to Markdown sections and separators without losing saved text', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.message.components = [{ type: 17, components: [
		{ type: 10, content: '# Памятка' }, { type: 14, spacing: 2, divider: true },
		{ type: 9, components: [{ type: 10, content: 'Инструкция' }], accessory: { type: 2, style: 5, label: 'Открыть', url: 'https://example.com' } }
	] }]
	const { snapshot } = require('../src/dashboard/messageEditor')
	const fields = snapshot(f.message).fields.map((field, index) => ({ ...field, key: 'permanent.recruit.legacy.' + index, group: 'Памятка рекрута', default: field.value, variables: [] }))
	await store.save('bindings', { recruit: { link: f.message.url, fields } }, store.revision, 'admin')
	await store.save('templates', { [fields[0].key]: '# Сохранённая памятка' }, store.revision, 'admin')
	const config = await (await f.request('/api/config')).json()
	assert.equal(config.bindings.recruit.markdown, true)
	const document = config.templates.find(field => field.group === 'Памятка рекрута')
	assert.match(document.value, /Сохранённая памятка\n\n\*\*\*/)
	assert.match(document.value, /<section buttonLabel="Открыть" buttonLink="https:\/\/example.com">Инструкция<\/section>/)
	assert.equal(f.message.components[0].components[0].content, '# Памятка', 'opening the editor does not publish changes')
})
