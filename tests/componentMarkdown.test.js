const { test } = require('node:test')
const assert = require('node:assert/strict')
const markdown = require('../public/component-markdown')
const { buildEditPayload } = require('../src/services/containerMessageService')
const { createFixture } = require('./helpers/dashboardFixture')
const { store } = require('../src/dashboard/store')
const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } }

const source = '# Заголовок\n**Текст**\n***\n<img src="https://example.com/image.png" />\n___\n<section buttonLabel="Открыть" buttonLink="https://example.com">## Секция\nТекст с кнопкой</section>\n---\nКонец'

test('Markdown creates Discord separators, galleries and link-button sections in order', () => {
	const items = markdown.parse(source)
	assert.deepEqual(items.map(item => item.type), ['text', 'separator', 'image', 'separator', 'section', 'separator', 'text'])
	const container = buildEditPayload({ items }).components[0].toJSON()
	assert.deepEqual(container.components.map(item => item.type), [10, 14, 12, 14, 9, 14, 10])
	assert.equal(container.components[4].accessory.label, 'Открыть')
	assert.equal(container.components[4].accessory.url, 'https://example.com')
	assert.deepEqual(markdown.parse(markdown.stringify(items)), items)
})

test('legacy separator options and quoted URLs survive Markdown round-trip', () => {
	const items = [{ type: 'separator', spacing: 'large', divider: false }, { type: 'image', value: 'https://example.com/a?x=1&y=2' }, { type: 'section', value: '**Текст**', btnLabel: 'Ссылка "тут" <&>', btnLink: 'https://example.com' }]
	assert.deepEqual(markdown.parse(markdown.stringify(items)), items)
})

test('separator syntax preserves Discord spacing and attachment URLs', () => {
	for (const [source, spacing] of [['---', 1], ['***', 2]]) {
		const items = markdown.parse(source)
		assert.equal(buildEditPayload({ items }).components[0].toJSON().components[0].spacing, spacing)
	}
	assert.equal(markdown.parse('<img src="attachment://invites.png" />')[0].value, 'attachment://invites.png')
	assert.throws(() => markdown.parse('<img src="attachment://../secret" />'))
})


test('code is isolated; malformed tags, unsafe URLs and component overflow reject', () => {
	const code = '```html\n---\n<img src="javascript:alert(1)" />\n```'
	assert.deepEqual(markdown.parse(code), [{ type: 'text', value: code }])
	for (const text of ['<img src="javascript:alert(1)" />', '<img src="https://example.com" onerror="alert(1)" />', '<img />', '<section buttonLabel="X" buttonLink="https://example.com">missing close', '<section buttonLabel="X" buttonLink="https://example.com">\n---\n</section>', '<img src="https://user:secret@example.com" />']) assert.throws(() => markdown.parse(text), undefined, text)
	assert.throws(() => buildEditPayload({ items: Array.from({ length: 14 }, () => ({ type: 'section', value: 'X', btnLabel: 'X', btnLink: 'https://example.com' })) }), /Проверьте/)
})

test('command template text expands without altering working action buttons', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const response = await f.request('/api/templates', { body: { revision: store.revision, values: { 'invite.5': '<img src="https://example.com/image.png" />', 'invite.6': '<section buttonLabel="Открыть" buttonLink="https://example.com">Текст</section>' } } })
	assert.equal(response.status, 200)
	const payload = (await require('../src/commands/admin/invite').buildPayload()).components[0].toJSON()
	assert.ok(payload.components.some(component => component.type === 12 && component.items[0].media.url === 'https://example.com/image.png'))
	assert.ok(payload.components.some(component => component.type === 9 && component.accessory.label === 'Открыть'))
	assert.ok(payload.components.some(component => component.type === 9 && component.accessory.custom_id === 'open_invite_modal'))
	const bad = await f.request('/api/templates', { body: { revision: store.revision, values: { 'invite.3': source } } })
	assert.equal(bad.status, 400)
})

test('simple permanent templates use one Markdown field across repeated structure changes and reset', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.message.attachments.clear()
	f.message.components = [{ type: 17, components: [{ type: 10, content: 'Исходный текст' }] }]
	let config = await (await f.request('/api/permanent-message', { body: { kind: 'recruit', link: f.message.url, revision: store.revision } })).json()
	const fields = config.templates.filter(field => field.group === 'Памятка рекрута')
	assert.equal(fields.length, 1); assert.equal(fields[0].path, 'markdown')
	for (const value of [source, '# Второе сохранение\n---\nГотово', null]) {
		const response = await f.request('/api/templates', { body: { revision: config.revision, values: { [fields[0].key]: value } } })
		assert.equal(response.status, 200)
		config = await response.json()
		assert.equal(config.syncResults[0].ok, true)
	}
	assert.equal(f.message.components[0].components[0].content, 'Исходный текст')
})

test('message edits expand container text while preserving action buttons and attachments', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const { snapshot, applyFields } = require('../src/dashboard/messageEditor')
	const field = snapshot(f.message).fields.find(field => field.components)
	const action = structuredClone(f.message.components[0].components[1])
	const payload = applyFields(f.message, { [field.path]: source })
	assert.deepEqual(payload.components[0].components.at(-2), action)
	assert.ok(payload.components[0].components.some(component => component.type === 12 && component.items[0].media.url === 'https://example.com/image.png'))
	assert.equal(f.message.attachments.size, 1)
})
