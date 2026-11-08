const { test } = require('node:test')
const assert = require('node:assert/strict')
const document = require('../public/template-document')
const catalog = require('../src/dashboard/templates.json')
const { createFixture } = require('./helpers/dashboardFixture')
const { store } = require('../src/dashboard/store')

test('all template groups round-trip through one document without changing their values', () => {
	for (const group of new Set(Object.values(catalog).map(field => field.group))) {
		const fields = Object.entries(catalog).filter(([, field]) => field.group === group).map(([key, field]) => ({ ...field, key, value: field.default }))
		const values = Object.fromEntries(fields.map(field => [field.key, field.value]))
		assert.deepEqual(document.parse(document.stringify(fields, values), fields), values, group)
	}
})

test('source edits retain variables, button labels, URLs and line endings', () => {
	const fields = [{ key: 'title', value: '# Привет, {user}\n' }, { key: 'button', value: 'Открыть' }, { key: 'url', value: 'https://example.com' }]
	const source = document.stringify(fields, {}).replace('Привет', 'Добро пожаловать').replace('Открыть', 'Перейти')
	assert.deepEqual(document.parse(source, fields), { title: '# Добро пожаловать, {user}\n', button: 'Перейти', url: 'https://example.com' })
})

test('missing, duplicate and unknown markers cannot silently overwrite other template values', () => {
	const fields = [{ key: 'first', value: 'Первый' }, { key: 'second', value: 'Второй' }]
	const source = document.stringify(fields, {})
	for (const invalid of [source.replace('<!-- template:first -->', ''), source.replace('template:second', 'template:first'), source.replace('template:second', 'template:other')]) assert.throws(() => document.parse(invalid, fields))
})

test('existing single-document templates stay plain Markdown without markers', () => {
	const fields = [{ key: 'permanent.recruit.1.0', value: '# Текст\n---\n<img src="https://example.com/image.png" />' }]
	assert.equal(document.stringify(fields, {}), fields[0].value)
	assert.deepEqual(document.parse(fields[0].value, fields), { [fields[0].key]: fields[0].value })
})

test('rules save as freely editable Markdown, sync, reload and reset without field boundaries', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.message.attachments.set('rules', { name: 'rules.png', url: 'https://cdn.discordapp.com/rules.png' })
	await f.request('/api/permanent-message', { body: { kind: 'rules', link: f.message.url, revision: store.revision } })
	for (const value of ['# Полностью новые правила\n---\n## Раздел без номера\nПроизвольный текст', '## Другой порядок\n***\nТолько один пункт']) {
		const response = await f.request('/api/templates', { body: { revision: store.revision, values: { 'rules.document': value } } })
		assert.equal(response.status, 200)
		const config = await response.json()
		assert.equal(config.syncResults[0].ok, true)
		assert.equal(config.templates.find(field => field.key === 'rules.document').value, value)
		assert.match(JSON.stringify(f.message.components), /Раздел без номера|Другой порядок/)
		assert.doesNotMatch(JSON.stringify(f.message.components), /Правило — 1-1/)
	}
	const reset = await f.request('/api/templates', { body: { revision: store.revision, values: { 'rules.document': null } } })
	assert.equal(reset.status, 200)
	assert.match(JSON.stringify(f.message.components), /Правило — 1-1/)
})
