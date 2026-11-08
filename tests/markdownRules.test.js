const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const { createFixture } = require('./helpers/dashboardFixture')
const { store, createStore } = require('../src/dashboard/store')

const context = vm.createContext({})
vm.runInContext(readFileSync(require.resolve('../public/markdown.js'), 'utf8'), context)
const markdown = context.discordMarkdownToHtml

test('subtext, quote headings and interactive spoilers preserve Markdown and code isolation', () => {
	const html = markdown('-# подпись\n> # Первый\n> ## Второй\n> ### Третий\n> -# подпись цитаты\n||**секрет**||\n`||код||`\n```fix\n-# код\n```')
	assert.match(html, /<small class="discord-subtext">подпись<\/small>/)
	assert.match(html, /<blockquote><h1>Первый<\/h1><h2>Второй<\/h2><h3>Третий<\/h3>/)
	assert.match(html, /<small class="discord-subtext">подпись цитаты<\/small><\/blockquote>/)
	assert.match(html, /class="discord-spoiler".*tabindex="0".*<strong>секрет<\/strong><\/span>/)
	assert.match(html, /<code>\|\|код\|\|<\/code>/)
	assert.match(html, /<pre><code><span class="code-string">-# код\n<\/span><\/code><\/pre>/)
})

test('language fences highlight safely, ANSI resets colors and unknown languages stay plain', () => {
	assert.match(markdown('```css\ncolor: #fff; width: 12px;\n```'), /code-property.*color.*code-number.*#fff.*code-property.*width/)
	assert.match(markdown('```yml\nname: "value"\n# comment\n```'), /code-property.*name.*code-string.*value/)
	assert.match(markdown('```diff\n+add\n-remove\n```'), /code-addition.*add[\s\S]*code-deletion.*remove/)
	assert.match(markdown('```js\nconst value = 12\n```'), /code-keyword.*const.*code-number.*12/)
	assert.equal(markdown('```unknown-lang\n**plain**\n```'), '<pre><code>**plain**\n</code></pre>')
	assert.equal(markdown('```ansi\n\x1b[1;31mred\x1b[0mplain\n```'), '<pre><code><span style="color:#dc322f;font-weight:700">red</span>plain\n</code></pre>')
	for (const language of ['ansi', 'fix', 'css', 'yaml', 'js', 'unknown']) {
		const html = markdown('```' + language + '\n<img src=x onerror="alert(1)">\n```')
		assert.doesNotMatch(html, /<img/)
		assert.match(html, /&lt;/)
	}
})

test('new rules and sections save, survive reload, sync in order and reset', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.message.attachments.set('rules', { name: 'rules.png', url: 'https://cdn.discordapp.com/rules.png' })
	await f.request('/api/permanent-message', { body: { kind: 'rules', link: f.message.url, revision: store.revision } })
	const values = { 'rules.rule.1.4': '**Правило — 1-4**\nНовый пункт', 'rules.heading.5': '## Новый раздел', 'rules.rule.5.1': 'Правило нового раздела' }
	const response = await f.request('/api/templates', { body: { revision: store.revision, values } })
	assert.equal(response.status, 200)
	const config = await response.json()
	assert.equal(config.syncResults[0].ok, true)
	const texts = f.message.components[0].components.filter(component => component.type === 10).map(component => component.content)
	assert.equal(texts[texts.indexOf(values['rules.rule.1.4']) + 1], store.text('rules.heading.2'))
	assert.deepEqual(texts.slice(-2), [values['rules.heading.5'], values['rules.rule.5.1']])
	const reloaded = createStore(); await reloaded.init(f.pool)
	for (const [key, value] of Object.entries(values)) assert.equal(reloaded.snapshot().templates.find(field => field.key === key).value, value)
	const reset = await f.request('/api/templates', { body: { revision: store.revision, values: Object.fromEntries(Object.keys(values).map(key => [key, null])) } })
	assert.equal(reset.status, 200)
	assert.equal((await reset.json()).templates.some(field => Object.hasOwn(values, field.key)), false)
	assert.ok(!JSON.stringify(f.message.components).includes('Новый раздел'))
})

test('new rules reject missing sections, excess components, text overflow and stale revisions', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const save = (values, revision = store.revision) => f.request('/api/templates', { body: { revision, values } })
	assert.equal((await save({ 'rules.rule.5.1': 'Нет раздела' })).status, 400)
	assert.equal((await save(Object.fromEntries(Array.from({ length: 6 }, (_, i) => ['rules.rule.1.' + (i + 4), 'Новый пункт'])))).status, 400)
	assert.equal((await save({ 'rules.rule.1.4': 'x'.repeat(3800) })).status, 400)
	assert.equal((await save({ 'rules.heading.5': '## Новый' }, -1)).status, 409)
	assert.equal(store.snapshot().templates.some(field => field.key === 'rules.heading.5'), false)
})
