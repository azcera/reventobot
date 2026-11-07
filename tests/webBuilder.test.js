const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function builder(overrides = {}) {
	function element() {
		return {
			value: '', scrollTop: 0, style: {}, children: [],
			classList: { add() {}, remove() {}, toggle() {} },
			set innerHTML(value) {
				this.html = value
				this.children = []
				this.scrollTop = 0
			},
			get innerHTML() { return this.html },
			appendChild(child) { this.children.push(child) },
			replaceChildren(...children) { this.children = children; this.value = '' },
			add(child) { this.children.push(child) },
			querySelectorAll() { return [] }
		}
	}
	const elements = Object.fromEntries(
		['itemsContainer', 'insertAfter', 'componentCount', 'discordPreview',
			'messageLink', 'messageStatus', 'loadMessageBtn', 'saveMessageBtn', 'detachMessageBtn', 'sendBtn', 'channelId', 'channelNameHint']
			.map(id => [id, element()])
	)
	const context = vm.createContext({
		document: {
			addEventListener() {},
			getElementById: id => elements[id],
			querySelectorAll: () => Object.values(elements),
			createElement: element
		},
		Option: function (text, value) { this.text = text; this.value = value },
		localStorage: { setItem() {} }, confirm: () => true,
		setTimeout: () => 1, clearTimeout() {},
		...overrides
	})
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/markdown.js'), 'utf8'), context)
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context)
	return { elements, run: code => vm.runInContext(code, context) }
}

test('adding, moving and copying components preserves list scroll and data', () => {
	const { elements, run } = builder()
	run("addItem('text'); addItem('separator'); updateItemData(items[0].id, 'value', 'Текст')")
	elements.itemsContainer.scrollTop = 240
	run("addItem('image')")
	assert.equal(elements.itemsContainer.scrollTop, 240)
	run('moveItem(items[0].id, 1)')
	assert.equal(elements.itemsContainer.scrollTop, 240)
	assert.equal(run('items[1].value'), 'Текст')
	run('duplicateItem(items[1].id)')
	assert.equal(elements.itemsContainer.scrollTop, 240)
	assert.equal(run('items[2].value'), 'Текст')
	assert.equal(run('items[1].id !== items[2].id'), true)
	assert.equal(elements.componentCount.textContent, 'Компоненты: 4')
})

const importedMessage = {
	success: true, noColor: true, accentColor: '#5865f2',
	items: [{ id: 'import-0', type: 'text', value: 'Загружено' }],
	source: { url: 'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333',
		channelId: '222222222222222222', revision: 'a'.repeat(64), canEdit: true }
}

test('successful import populates draft, channel and editing controls without color settings', async () => {
	const { elements, run } = builder({ fetch: async () => ({ ok: true, json: async () => structuredClone(importedMessage) }) })
	elements.messageLink.value = importedMessage.source.url
	await run('loadMessage()')
	assert.equal(run('items[0].value'), 'Загружено')
	assert.equal(elements.channelId.value, importedMessage.source.channelId)
	assert.equal(elements.saveMessageBtn.hidden, false)
	assert.equal(elements.saveMessageBtn.disabled, false)
	assert.equal(elements.sendBtn.textContent, 'Отправить копию')
	assert.equal(run('requestPending'), false)
})

test('failed import preserves existing draft and source', async () => {
	const { elements, run } = builder({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Нет доступа' }) }) })
	run("addItem('text'); updateItemData(items[0].id, 'value', 'Мой черновик')")
	elements.messageLink.value = importedMessage.source.url
	await run('loadMessage()')
	assert.equal(run('items[0].value'), 'Мой черновик')
	assert.equal(run('messageSource'), null)
	assert.equal(elements.messageStatus.textContent, 'Нет доступа')
	assert.equal(elements.saveMessageBtn.hidden, true)
	assert.equal(run('requestPending'), false)
})

test('save uses imported source, refreshes revision and copy remains a separate send', async () => {
	const requests = []
	const { elements, run } = builder({ fetch: async (url, options) => {
		if (!options) return { ok: true, json: async () => structuredClone(importedMessage) }
		requests.push({ url, body: JSON.parse(options.body) })
		return { ok: true, json: async () => ({ success: true, source: { ...importedMessage.source, revision: 'b'.repeat(64) } }) }
	} })
	elements.messageLink.value = importedMessage.source.url
	await run('loadMessage()')
	elements.messageLink.value = 'https://other.example/'
	elements.channelId.value = '444444444444444444'
	await run('sendToDiscord(true)')
	assert.equal(requests[0].url, '/api/edit-container')
	assert.equal(requests[0].body.link, importedMessage.source.url)
	assert.equal(requests[0].body.revision, 'a'.repeat(64))
	assert.equal(run('messageSource.revision'), 'b'.repeat(64))
	await run('sendToDiscord({ type: "click" })')
	assert.equal(requests[1].url, '/api/send-container')
	assert.equal(requests[1].body.channelId, '444444444444444444')
	assert.equal(requests[1].body.link, undefined)
	assert.equal(run('messageSource.revision'), 'b'.repeat(64))
})

test('other authors disable saving while keeping copy available', async () => {
	const imported = structuredClone(importedMessage)
	imported.source.canEdit = false
	let fetches = 0
	const { elements, run } = builder({ fetch: async () => {
		fetches++
		return { ok: true, json: async () => imported }
	} })
	elements.messageLink.value = imported.source.url
	await run('loadMessage()')
	assert.equal(elements.saveMessageBtn.disabled, true)
	await run('sendToDiscord(true)')
	assert.equal(fetches, 1)
	assert.equal(elements.sendBtn.disabled, undefined)
})

test('preview URL quotes cannot create HTML attributes', () => {
	const { run } = builder()
	const html = run(`discordMarkdownToHtml('https://example.com/"onmouseover="alert(1)')`)
	assert.ok(html.includes('href="https://example.com/&quot;onmouseover=&quot;alert(1)"'))
})

test('inserts after chosen component and resets insertion target after deletion', () => {
	const { elements, run } = builder()
	run("addItem('text'); addItem('image')")
	elements.insertAfter.value = run('items[0].id')
	run("addItem('separator')")
	assert.equal(run("items.map(item => item.type).join(',')"), 'text,separator,image')
	assert.equal(elements.insertAfter.value, run('items[0].id'))
	run('deleteItem(items[0].id)')
	assert.equal(elements.insertAfter.value, '')
	run("addItem('section')")
	assert.equal(run('items[items.length - 1].type'), 'section')
})

test('headings do not add a blank line; regular text and code retain line breaks', () => {
	const { run } = builder()
	assert.equal(run("discordMarkdownToHtml('## Заголовок\\nТекст')"), '<h2>Заголовок</h2>Текст')
	assert.equal(run("discordMarkdownToHtml('Строка 1\\nСтрока 2')"), 'Строка 1<br>Строка 2')
	assert.equal(run("discordMarkdownToHtml('```\\nline 1\\nline 2```')"), '<pre><code>line 1\nline 2</code></pre>')
	assert.equal(run("discordMarkdownToHtml('## Заголовок\\n\\nТекст')"), '<h2>Заголовок</h2><br>Текст')
})
