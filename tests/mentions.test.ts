import { browserScript } from './helpers/browserScript'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { readFileSync } from 'node:fs'
import vm = require('node:vm')

const resources = {
	channels: [{ id: '111111111111111111', name: 'общий', type: 0 }, { id: '222222222222222222', name: 'Объявления', type: 5 }, { id: '333333333333333333', name: 'Категория', type: 4 }],
	roles: [{ id: '444444444444444444', name: 'Модератор' }, { id: '555555555555555555', name: 'Рекрут' }]
}

test('mention lookup filters channels and roles by name or ID', async () => {
	const { suggestions } = await import('../frontend/src/lib/mentions.js')
	assert.equal(suggestions({ kind: '#', text: 'ОБЪ' }, resources)[0].name, 'Объявления')
	assert.equal(suggestions({ kind: '@', text: '4444' }, resources)[0].name, 'Модератор')
	assert.equal(suggestions({ kind: '#', text: '' }, resources).length, 2)
	assert.equal(suggestions({ kind: '@', text: 'неизвестно' }, resources).length, 0)
})

test('headings, code, URLs, existing mentions and selections do not activate completion', async () => {
	const { queryAt } = await import('../frontend/src/lib/mentions.js')
	for (const text of ['#', '# ', '##', '## Заголовок', '### ', '-# подпись', '`@Мод', '```\n#общ', '<@&444', 'https://example.com/#общ', 'mail@Мод', '\\#общ']) assert.equal(queryAt(text, text.length), null, text)
	const text = '## Заголовок\nТекст #общ'
	assert.equal(queryAt(text, text.length)!.text, 'общ')
	assert.equal(queryAt('@Мод', 0, 4), null)
})

test('Markdown resolves names safely, preserves code and emits CSP-compatible spoilers', () => {
	const context = vm.createContext({})
	vm.runInContext(readFileSync(browserScript('markdown'), 'utf8'), context)
	context.setDiscordMentionResources(resources)
	const html = context.discordMarkdownToHtml('## Заголовок\n<#111111111111111111> <@&444444444444444444>')
	assert.match(html, /<span class="discord-mention">#общий<\/span>/)
	assert.match(html, /<span class="discord-mention">@Модератор<\/span>/)
	assert.equal(context.discordMarkdownToHtml('`<@&444444444444444444>`'), '<code>&lt;@&amp;444444444444444444&gt;</code>')
	context.setDiscordMentionResources({ channels: [], roles: [{ id: '444444444444444444', name: '<img src=x onerror=alert(1)> **role**' }] })
	const hostile = context.discordMarkdownToHtml('<@&444444444444444444>')
	assert.match(hostile, /&lt;img/); assert.doesNotMatch(hostile, /<img/); assert.match(hostile, /\*\*role\*\*/)
	const spoiler = context.discordMarkdownToHtml('||**секрет**||')
	assert.match(spoiler, /aria-expanded="false"/)
	assert.doesNotMatch(spoiler, /onclick|onkeydown/)
})
