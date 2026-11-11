import { browserScript } from './helpers/browserScript'
import type { HistoryEntry, TemplateField } from '../frontend/src/types'
import type { RawComponent } from '../src/types'
type JournalPayload = { flags: number; allowedMentions: { parse: string[] }; components: (RawComponent & { components: RawComponent[] })[] }
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { readFileSync } from 'node:fs'
import vm = require('node:vm')
const { MessageFlags, ContainerBuilder }: typeof import("discord.js") = require('discord.js')
const { createFixture } = require('./helpers/dashboardFixture')
const { store }: typeof import("../src/dashboard/store") = require('../src/dashboard/store')
const { diffLines }: typeof import("../src/dashboard/changeLog") = require('../src/dashboard/changeLog')

test('quotes and lists render in the shared preview without interpreting code or HTML', () => {
	const context = vm.createContext({})
	vm.runInContext(readFileSync(browserScript('markdown'), 'utf8'), context)
	const html = context.discordMarkdownToHtml('> **Цитата**\n> вторая строка\n- первый\n- второй\n```\n> код\n- код\n**код**\n```\n`**код**`\n<img src=x>')
	assert.match(html, /<blockquote><strong>Цитата<\/strong><br>вторая строка<\/blockquote>/)
	assert.match(html, /<ul><li>первый<\/li><li>второй<\/li><\/ul>/)
	assert.match(html, /<pre><code>&gt; код\n- код\n\*\*код\*\*\n<\/code><\/pre>/)
	assert.match(html, /<code>\*\*код\*\*<\/code>/)
	assert.doesNotMatch(html, /<img/)
})

test('line diff handles additions, deletions, separate edits and omits unchanged interiors', () => {
	assert.equal(diffLines(['a'], ['a']), '')
	assert.equal(diffLines([], ['new']), '+new')
	assert.equal(diffLines(['old'], []), '-old')
	const diff = diffLines(['start', 'old', 'c1', 'c2', 'c3', 'c4', 'end'], ['start', 'new', 'c1', 'c2', 'c3', 'c4', 'added', 'end'])
	assert.match(diff, /-old\n\+new/)
	assert.match(diff, /\+added/)
	assert.doesNotMatch(diff, /c2|c3/)
})

test('change journal channel is selected and changed through dashboard settings independently of application logs', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const { logMessageChange }: typeof import("../src/dashboard/changeLog") = require('../src/dashboard/changeLog')
	const destinations: string[] = []
	const fetchChannel = f.guild.channels.fetch
	f.guild.channels.fetch = async (id: string) => { destinations.push(id); return fetchChannel(id) }
	const sent: JournalPayload[] = []; f.channel.send = async (payload: JournalPayload) => sent.push(payload)
	await store.save('settings', { LOG_CHANNEL_ID: f.channelId }, store.revision, 'admin')
	const change = { guild: f.guild, actor: { id: f.userId, name: 'Редактор' }, kind: 'rules', link: f.message.url, before: ['Было'], after: ['Стало'] }
	assert.match((await logMessageChange(change)).logError!, /Выберите канал/)
	assert.equal(sent.length, 0)
	for (const id of [f.channelId, '555555555555555555']) {
		const response = await f.request('/api/settings', { body: { revision: store.revision, values: { CHANGELOG_CHANNEL_ID: id } } })
		assert.equal(response.status, 200)
		const config = await response.json()
		const setting = config.settings.find((field: TemplateField) => field.key === 'CHANGELOG_CHANNEL_ID')
		assert.equal(setting.label, 'Канал журнала изменений')
		assert.equal(setting.type, 'channel')
		assert.equal(setting.value, id)
		await logMessageChange(change)
		assert.equal(destinations.at(-1), id)
		assert.equal(store.getSetting('LOG_CHANNEL_ID'), f.channelId)
	}
	assert.equal(sent.length, 2)
})

test('template sync logs changed fragments once, preserve actors and report delivery failure', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const sent: JournalPayload[] = []
	f.channel.send = async (payload: JournalPayload) => { sent.push(payload) }
	await f.request('/api/settings', { body: { revision: 0, values: { CHANGELOG_CHANNEL_ID: f.channelId } } })
	let config = await (await f.request('/api/permanent-message', { body: { kind: 'recruit', link: f.message.url, revision: store.revision } })).json()
	const field = config.templates.find((field: TemplateField) => field.group === 'Памятка рекрута')
	config = await (await f.request('/api/templates', { body: { revision: config.revision, values: { [field.key]: '## Новая памятка\n- Требование' } } })).json()
	assert.deepEqual(config.syncResults, [{ kind: 'recruit', ok: true }])
	assert.equal(sent.length, 1)
	assert.equal(sent[0].flags, MessageFlags.IsComponentsV2)
	assert.deepEqual(sent[0].allowedMentions.parse, [])
	new ContainerBuilder(sent[0].components[0]).toJSON()
	const body = JSON.stringify(sent[0])
	assert.match(body, /Администратор/)
	assert.match(body, /-## Исходный заголовок/)
	assert.match(body, /\+## Новая памятка/)
	await f.request('/api/permanent-message/sync', { body: { kind: 'recruit' } })
	assert.equal(sent.length, 1)
	f.channel.send = async () => { throw new Error('Нет прав') }
	const response = await f.request('/api/templates', { body: { revision: config.revision, values: { [field.key]: '## Следующая правка' } } })
	assert.equal(response.status, 200)
	const result = await response.json()
	assert.match(result.syncResults[0].logError, /Нет прав/)
	assert.equal(f.message.components[0].components[0].content, '## Следующая правка')

	const history = await (await f.request('/api/history')).json()
	const changes = history.filter((entry: HistoryEntry) => entry.action === 'message.change').map((entry: HistoryEntry) => typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details)
	assert.equal(changes.length, 2)
	assert.equal(changes[0].actorName, 'Администратор')
	assert.match(changes[0].logError, /Нет прав/)
	const saved = history.find((entry: HistoryEntry) => entry.action === 'templates')
	const details = typeof saved.details === 'string' ? JSON.parse(saved.details) : saved.details
	assert.equal(details.fields[field.key].before, '## Новая памятка\n- Требование')
	assert.equal(details.fields[field.key].after, '## Следующая правка')
})

test('long changes split into valid V2 containers and embedded fences cannot escape diff', async t => {
	const f = await createFixture(); t.after(() => f.close())
	await store.save('settings', { CHANGELOG_CHANNEL_ID: f.channelId }, store.revision, 'admin')
	const sent: JournalPayload[] = []; f.channel.send = async (payload: JournalPayload) => sent.push(payload)
	const { logMessageChange }: typeof import("../src/dashboard/changeLog") = require('../src/dashboard/changeLog')
	await logMessageChange({ guild: f.guild, actor: { id: f.userId, name: '@everyone' }, kind: 'rules', link: f.message.url, before: ['a'.repeat(3500)], after: ['```' + 'b'.repeat(3500)] })
	assert.ok(sent.length > 1)
	for (const payload of sent) {
		new ContainerBuilder(payload.components[0]).toJSON()
		const text = payload.components[0].components.filter(item => item.type === 10).map(item => item.content).join('')
		assert.ok(text.length <= 4000)
		assert.equal((payload.components[0].components[2].content!.match(/```/g) || []).length, 2)
	}
})

test('builder edits of a bound message use the same change journal', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	await store.save('settings', { CHANGELOG_CHANNEL_ID: f.channelId }, store.revision, 'admin')
	f.message.components = [{ type: 17, components: [{ type: 10, content: 'Старая памятка' }, { type: 14, divider: true, spacing: 1 }] }]
	f.message.attachments.clear()
	await f.request('/api/permanent-message', { body: { kind: 'recruit', link: f.message.url, revision: store.revision } })
	const sent: JournalPayload[] = []; f.channel.send = async (payload: JournalPayload) => sent.push(payload)
	const imported = await (await f.request('/api/container-message?link=' + encodeURIComponent(f.message.url))).json()
	imported.items[0].value = 'Новая памятка'
	const response = await f.request('/api/edit-container', { body: { ...imported, link: f.message.url, revision: imported.source.revision } })
	assert.equal(response.status, 200)
	assert.equal(sent.length, 1)
	assert.match(JSON.stringify(sent[0]), /-Старая памятка/)
	assert.match(JSON.stringify(sent[0]), /\+Новая памятка/)
})
