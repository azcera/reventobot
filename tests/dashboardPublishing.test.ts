import type { TemplateField } from '../frontend/src/types'
import { moduleStub } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert = require('node:assert/strict')
import type { MutableMessagePayload, RawComponent } from '../src/types'
import { componentJSON } from '../src/types'
type PublishedMessage = { url: string; components: RawComponent[]; attachments: Map<string, { name: string; url: string }>; lastPayload?: unknown }
const { Collection }: typeof import("discord.js") = require('discord.js')
const { createFixture } = require('./helpers/dashboardFixture')
const { store, createStore }: typeof import("../src/dashboard/store") = require('../src/dashboard/store')
const { getNavigationContainer }: typeof import("../src/commands/admin/navigationBuilder") = require('../src/commands/admin/navigationBuilder')
const navigation: typeof import("../src/dashboard/navigationMessages") = require('../src/dashboard/navigationMessages')
const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = moduleStub({ id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } })

test('all four templates publish to a selected channel, persist and update without duplicates', async t => {
	for (const kind of ['rules', 'invite', 'promotion', 'recruit']) await t.test(kind, async t => {
		const f = await createFixture(); t.after(() => f.close()); await f.login()
		let sent!: PublishedMessage, sends = 0
		f.channel.send = async (payload: MutableMessagePayload) => {
			sends++
			sent = { ...f.message, guildId: f.guild.id, attachments: new Collection(), components: payload.components.map(componentJSON) }
			if (['rules', 'invite'].includes(kind)) for (const name of ['rules.png', 'invites.png', 'revento.png']) sent.attachments.set(name, { name, url: 'https://cdn.example.com/' + name })
			return sent
		}
		f.channel.messages.fetch = async () => sent
		if (['promotion', 'recruit'].includes(kind)) await store.save('templates', { [kind + '.document']: '# Сохранённый шаблон\n---\nТекст' }, store.revision, 'admin')
		const publish = () => f.request('/api/permanent-message/publish', { body: { kind, channelId: f.channelId, revision: store.revision } })
		let response = await publish()
		assert.equal(response.status, 200, await response.clone().text())
		let config = await response.json()
		assert.equal(config.bindings[kind].link, sent.url)
		if (['promotion', 'recruit'].includes(kind)) {
			assert.match(JSON.stringify(sent.components), /Сохранённый шаблон/)
			assert.equal(config.templates.filter((field: TemplateField) => field.group === (kind === 'promotion' ? 'Система повышения' : 'Памятка рекрута')).length, 1)
		}
		const restarted = createStore(); await restarted.init(f.pool)
		assert.equal(restarted.bindings[kind].link, sent.url)
		response = await publish(); assert.equal(response.status, 200, await response.clone().text())
		assert.equal(sends, 1)
		assert.ok(sent.lastPayload)
		if (kind === 'invite') assert.equal(sent.components[0].components!.at(-1)!.accessory!.custom_id, 'open_invite_modal')
	})
})

test('publication validates revision and permissions and rolls back a message if remembering fails', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	let sends = 0, deleted = false
	f.channel.send = async () => { sends++; return { ...f.message, delete: async () => { deleted = true } } }
	const publish = (revision: number) => f.request('/api/permanent-message/publish', { body: { kind: 'recruit', channelId: f.channelId, revision } })
	assert.equal((await publish(-1)).status, 409)
	f.channel.permissionsFor = () => ({ has: () => false })
	assert.equal((await publish(store.revision)).status, 400)
	assert.equal(sends, 0)
	f.channel.permissionsFor = () => ({ has: () => true })
	const save = store.save
	store.save = async () => { throw new Error('database unavailable') }
	try { assert.equal((await publish(store.revision)).status, 502) }
	finally { store.save = save }
	assert.equal(deleted, true)
	assert.equal(store.bindings.recruit, undefined)
})

test('copying an imported template preserves actions and resolves source attachments', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	f.message.attachments.set('banner', { name: 'banner.png', url: 'https://cdn.example.com/banner.png' })
	assert.equal((await f.request('/api/permanent-message', { body: { kind: 'recruit', link: f.message.url, revision: store.revision } })).status, 200)
	const target = { ...f.channel, id: '555555555555555555' }
	let payload!: MutableMessagePayload
	target.send = async (value: MutableMessagePayload) => {
		payload = value
		return { ...f.message, id: '666666666666666666', channelId: target.id, url: `https://discord.com/channels/${f.guild.id}/${target.id}/666666666666666666`, components: value.components }
	}
	f.guild.channels.fetch = f.client.channels.fetch = async (id: string) => id === target.id ? target : f.channel
	const response = await f.request('/api/permanent-message/publish', { body: { kind: 'recruit', channelId: target.id, revision: store.revision } })
	assert.equal(response.status, 200, await response.clone().text())
	assert.equal(componentJSON(payload.components[0]).components![1].accessory!.custom_id, 'open_invite_modal')
	assert.equal(componentJSON(payload.components[0]).components![2].items![0].media.url, 'https://cdn.example.com/banner.png')
	assert.equal(store.bindings.recruit.link.split('/')[5], target.id)
	assert.equal(f.message.lastPayload, undefined)
})

async function navigationFixture(t: TestContext) {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	Object.assign(f.channel, { isThread: () => false, isTextBased: () => true })
	await store.save('settings', { PARENT_CHANNEL_ID: f.channelId }, store.revision, 'admin')
	const search = { type: 1, components: [{ type: 2, style: 1, custom_id: 'archive_find', label: 'Найти архив' }] }
	const main = { ...f.message, guildId: f.guild.id, components: [getNavigationContainer(null, false).toJSON(), search] }
	const personal = { ...f.message, guildId: f.guild.id, id: '777777777777777777', channelId: '888888888888888888', components: [getNavigationContainer('## <@333333333333333333>\nЛичное приветствие', false).toJSON()] }
	const archiveCalls: boolean[] = []
	const thread = { id: personal.channelId, archived: true, archiveTimestamp: 1000, isThread: () => true, isTextBased: () => true, setArchived: async (value: boolean) => { archiveCalls.push(value); thread.archived = value }, messages: { fetch: async (options: { limit?: number }) => options.limit ? new Collection([[personal.id, personal]]) : personal } }
	f.channel.messages.fetch = async (options: { limit?: number }) => options.limit ? new Collection([[main.id, main]]) : main
	const privateCalls: (Date | undefined)[] = []
	f.channel.threads = {
		fetchActive: async () => ({ threads: new Collection() }),
		fetchArchived: async (options: { type: string; before?: Date }) => {
			if (options.type === 'private') {
				privateCalls.push(options.before)
				return { threads: new Collection([[thread.id, thread]]), hasMore: !options.before }
			}
			return { threads: new Collection(), hasMore: false }
		}
	}
	f.guild.channels.fetch = async (id: string) => id === thread.id ? thread : f.channel
	return { ...f, main, personal, thread, archiveCalls, privateCalls, search }
}

test('saving navigation discovers legacy copies, paginates private archives and preserves both variants', async t => {
	const f = await navigationFixture(t)
	const intro = structuredClone(f.personal.components[0].components.slice(0, 2))
	const response = await f.request('/api/templates', { body: { revision: store.revision, values: { 'navigation.1': '# Новая навигация', 'navigation.item.1.link': 'https://example.com/new-rules' } } })
	assert.equal(response.status, 200)
	const config = await response.json()
	assert.equal(config.syncResults[0].ok, true, JSON.stringify(config.syncResults))
	assert.equal(config.syncResults[0].updated, 2)
	assert.deepEqual(f.main.components[1], f.search)
	assert.deepEqual(f.personal.components[0].components.slice(0, 2), intro)
	for (const message of [f.main, f.personal]) {
		assert.match(JSON.stringify(message.components), /Новая навигация/)
		assert.match(JSON.stringify(message.components), /https:\/\/example.com\/new-rules/)
		assert.deepEqual(message.lastPayload.allowedMentions, { parse: [], repliedUser: false })
	}
	assert.deepEqual(f.archiveCalls, [false, true])
	assert.equal(f.privateCalls.length, 2)
	assert.ok(f.privateCalls[1] instanceof Date)
	assert.equal((await store.navigationMessages(f.guild.id)).length, 2)
	await store.init(f.pool)
	await store.save('templates', { 'navigation.1': '# Ещё одно название' }, store.revision, 'admin')
	const retry = await f.request('/api/navigation/sync', { body: {} })
	assert.equal((await retry.json()).syncResults[0].updated, 2)
	assert.match(JSON.stringify(f.personal.components), /Ещё одно название/)
})

test('navigation partial failures are reported, saved edits survive and retry restores archived status', async t => {
	const f = await navigationFixture(t)
	const edit = f.personal.edit
	f.personal.edit = async () => { throw new Error('Missing Permissions') }
	await store.save('templates', { 'navigation.item.1.label': 'Новые правила' }, store.revision, 'admin')
	let result = (await navigation.sync(f.client, f.guild))[0]
	assert.equal(result.ok, false)
	assert.ok('updated' in result && 'failures' in result)
	assert.equal(result.updated, 1)
	assert.equal(result.failures[0].messageId, f.personal.id)
	assert.equal(store.text('navigation.item.1.label'), 'Новые правила')
	assert.equal(f.thread.archived, true)
	f.personal.edit = edit
	result = (await navigation.sync(f.client, f.guild))[0]
	assert.equal(result.ok, true)
	assert.ok('updated' in result)
	assert.equal(result.updated, 2)
	assert.equal(f.thread.archived, true)
})


test('custom template persists before publication and synchronizes saved edits after restart', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	let response = await f.request('/api/templates/create', { body: { name: 'Мой шаблон', revision: store.revision } })
	assert.equal(response.status, 200, await response.clone().text())
	let config = await response.json()
	const kind = Object.keys(config.bindings).find(key => key.startsWith('custom-'))!
	let field = config.templates.find((field: TemplateField) => field.group === 'Мой шаблон')
	assert.ok(field); assert.equal(config.bindings[kind].link, '')
	response = await f.request('/api/templates', { body: { revision: config.revision, values: { [field.key]: '# Мой текст\n<img src="https://example.com/banner.png" />' } } })
	assert.equal(response.status, 200, await response.clone().text())
	const restart = createStore(); await restart.init(f.pool)
	assert.match(restart.text(field.key), /Мой текст/)
	let sends = 0
	f.channel.send = async (payload: MutableMessagePayload) => {
		sends++; f.message.components = payload.components.map(componentJSON); f.message.attachments.clear(); return f.message
	}
	response = await f.request('/api/permanent-message/publish', { body: { kind, channelId: f.channelId, revision: store.revision } })
	assert.equal(response.status, 200, await response.clone().text())
	config = await response.json()
	field = config.templates.find((field: TemplateField) => field.group === 'Мой шаблон')
	assert.equal(config.bindings[kind].link, f.message.url)
	assert.match(JSON.stringify(f.message.components), /banner.png/)
	response = await f.request('/api/templates', { body: { revision: store.revision, values: { [field.key]: '# Без картинки' } } })
	assert.equal(response.status, 200, await response.clone().text())
	assert.equal((await response.json()).syncResults[0].ok, true)
	assert.match(JSON.stringify(f.message.components), /Без картинки/)
	assert.doesNotMatch(JSON.stringify(f.message.components), /banner.png/)
	assert.equal(sends, 1)
	response = await f.request('/api/permanent-message', { body: { kind, link: '', revision: store.revision } })
	assert.equal(response.status, 200, await response.clone().text())
	assert.equal(store.bindings[kind].link, '')
	assert.equal(store.text(field.key), '# Без картинки')
	assert.equal((await f.request('/api/templates/create', { body: { name: 'Мой шаблон', revision: store.revision } })).status, 400)
	assert.equal((await f.request('/api/templates/create', { body: { name: 'Другой', revision: -1 } })).status, 409)
})
