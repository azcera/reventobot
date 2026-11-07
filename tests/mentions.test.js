const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')

function editor() {
	const handlers = {}, body = { children: [], appendChild(child) { this.children.push(child) } }
	function element() {
		return {
			children: [], style: {}, attributes: {}, handlers: {},
			setAttribute(key, value) { this.attributes[key] = value },
			addEventListener(key, handler) { this.handlers[key] = handler },
			appendChild(child) { this.children.push(child) },
			remove() { body.children = body.children.filter(child => child !== this) },
			contains(target) { return target === this || this.children.includes(target) },
			scrollIntoView() {}
		}
	}
	const context = vm.createContext({
		document: { body, createElement: element, addEventListener: (name, handler) => { handlers[name] = handler } },
		window: { innerWidth: 1000, innerHeight: 800 }, Event
	})
	for (const file of ['markdown.js', 'mentions.js']) vm.runInContext(readFileSync(require.resolve('../public/' + file), 'utf8'), context)
	vm.runInContext(`discordMentions.setResources({
		channels: [{ id: '111111111111111111', name: 'общий', type: 0 }, { id: '222222222222222222', name: 'Объявления', type: 5 }, { id: '333333333333333333', name: 'Категория', type: 4 }],
		roles: [{ id: '444444444444444444', name: 'Модератор' }, { id: '555555555555555555', name: 'Рекрут' }]
	})`, context)
	const input = {
		tagName: 'TEXTAREA', value: '', selectionStart: 0, selectionEnd: 0, updates: 0,
		getBoundingClientRect: () => ({ left: 10, bottom: 200, width: 500 }), focus() {},
		setRangeText(text, start, end) {
			this.value = this.value.slice(0, start) + text + this.value.slice(end)
			this.selectionStart = this.selectionEnd = start + text.length
		},
		dispatchEvent(event) { this.updates++; handlers[event.type]({ target: this }) }
	}
	return {
		run: code => vm.runInContext(code, context), body, input,
		type(value, caret = value.length) {
			input.value = value; input.selectionStart = input.selectionEnd = caret
			handlers.input({ target: input })
		},
		key(key) {
			let prevented = false
			handlers.keydown({ target: input, key, preventDefault() { prevented = true } })
			return prevented
		}
	}
}

test('mention lookup filters server channels and roles by name or ID', () => {
	const { run } = editor()
	assert.equal(run(`discordMentions.suggestions({ kind: '#', text: 'ОБЪ' })[0].name`), 'Объявления')
	assert.equal(run(`discordMentions.suggestions({ kind: '@', text: '4444' })[0].name`), 'Модератор')
	assert.equal(run(`discordMentions.suggestions({ kind: '#', text: '' }).length`), 2)
	assert.equal(run(`discordMentions.suggestions({ kind: '@', text: 'неизвестно' }).length`), 0)
})

test('headings, code, URLs and existing mentions never activate completion', () => {
	const ui = editor()
	for (const text of ['#', '# ', '##', '## Заголовок', '### ', '-# подпись', '`@Мод', '```\n#общ', '<@&444', 'https://example.com/#общ', 'mail@Мод', '\\#общ']) {
		ui.type(text)
		assert.equal(ui.body.children.length, 0, text)
		assert.equal(ui.key('Enter'), false, text)
	}
	ui.type('## Заголовок\nТекст #общ')
	assert.equal(ui.body.children.length, 1)
	assert.equal(ui.run(`discordMarkdownToHtml('## Заголовок\\nТекст')`), '<h2>Заголовок</h2>Текст')
})

test('keyboard and mouse insert Discord mentions at the caret and update the draft', () => {
	const ui = editor()
	ui.type('Привет @мод, хвост', 'Привет @мод'.length)
	assert.equal(ui.body.children[0].children[0].textContent, '@Модератор')
	assert.equal(ui.key('Enter'), true)
	assert.equal(ui.input.value, 'Привет <@&444444444444444444> , хвост')
	assert.equal(ui.input.updates, 1)
	assert.equal(ui.body.children.length, 0)
	ui.type('Канал #общ')
	ui.body.children[0].children[0].handlers.click()
	assert.equal(ui.input.value, 'Канал <#111111111111111111> ')
	assert.equal(ui.input.updates, 2)
})

test('arrows select a role, Escape closes suggestions, and Tab accepts selection', () => {
	const ui = editor()
	ui.type('@')
	assert.equal(ui.key('ArrowDown'), true)
	assert.equal(ui.body.children[0].children[1].attributes['aria-selected'], 'true')
	ui.key('Tab')
	assert.equal(ui.input.value, '<@&555555555555555555> ')
	ui.type('@')
	assert.equal(ui.key('Escape'), true)
	assert.equal(ui.body.children.length, 0)
})

test('preview resolves names safely while preserving literal mentions in code', () => {
	const { run } = editor()
	const html = run(`discordMarkdownToHtml('## Заголовок\\n<#111111111111111111> <@&444444444444444444>')`)
	assert.match(html, /<h2>Заголовок<\/h2><span class="discord-mention">#общий<\/span>/)
	assert.match(html, /<span class="discord-mention">@Модератор<\/span>/)
	assert.equal(run('discordMarkdownToHtml("`<@&444444444444444444>`")'), '<code>&lt;@&amp;444444444444444444&gt;</code>')
	run(`discordMentions.setResources({ roles: [{ id: '444444444444444444', name: '<img src=x onerror=alert(1)> **role**' }] })`)
	const hostile = run(`discordMarkdownToHtml('<@&444444444444444444>')`)
	assert.ok(hostile.includes('&lt;img'))
	assert.ok(!hostile.includes('<img'))
	assert.ok(hostile.includes('**role**'))
})
