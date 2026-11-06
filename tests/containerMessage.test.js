const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection, MessageFlags, MessageFlagsBitField } = require('discord.js')
const { buildWebContainer } = require('../src/services/containerService')
const {
	parseMessageLink, parseContainerMessage, messageRevision, registerContainerMessageRoutes
} = require('../src/services/containerMessageService')

const guildId = '111111111111111111'
const channelId = '222222222222222222'
const messageId = '333333333333333333'
const link = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
const draft = {
	noColor: false, accentColor: '#000000', items: [
		{ type: 'text', value: '## Заголовок\nТекст' },
		{ type: 'separator', spacing: 'large', divider: false },
		{ type: 'image', value: 'https://example.com/image.png' },
		{ type: 'section', value: 'Секция', btnLabel: 'Открыть', btnLink: 'https://example.com/' }
	]
}

function message(data = draft) {
	return {
		id: messageId, channelId, url: link, author: { id: 'bot' }, webhookId: null,
		flags: new MessageFlagsBitField(MessageFlags.IsComponentsV2),
		components: [buildWebContainer(data).components[0].toJSON()],
		content: '', attachments: new Collection(), embeds: [], editedTimestamp: null
	}
}

function routes(current = message()) {
	const handlers = {}
	let edits = 0
	let fetches = 0
	let ready = true
	let editPayload
	current.edit = async payload => {
		edits++
		editPayload = payload
		current.components = payload.components.map(component => component.toJSON())
		current.editedTimestamp = Date.now()
		return current
	}
	const channel = {
		guildId, isTextBased: () => true,
		messages: { fetch: async options => {
			assert.deepEqual(options, { message: messageId, force: true, cache: false })
			fetches++
			return current
		} }
	}
	registerContainerMessageRoutes({
		get: (route, handler) => { handlers[route] = handler },
		post: (route, handler) => { handlers[route] = handler }
	}, {
		user: { id: 'bot' }, isReady: () => ready,
		channels: { fetch: async id => { assert.equal(id, channelId); return channel } }
	})
	return {
		current, channel, get edits() { return edits }, get fetches() { return fetches },
		get editPayload() { return editPayload }, setReady: value => { ready = value },
		async request(route, data = {}) {
			const response = {
				statusCode: 200, headers: {},
				set(name, value) { this.headers[name] = value; return this },
				status(code) { this.statusCode = code; return this },
				json(body) { this.body = body; return this }
			}
			await handlers[route]({ query: data, body: data }, response)
			return response
		}
	}
}

test('message links only accept Discord HTTPS server message URLs', () => {
	assert.deepEqual(parseMessageLink(link), { guildId, channelId, messageId })
	assert.deepEqual(parseMessageLink(link.replace('discord.com', 'ptb.discord.com')), { guildId, channelId, messageId })
	for (const invalid of [undefined, '', link.replace('https:', 'http:'), link.replace('discord.com', 'discord.com.evil.test'),
		link.replace('discord.com', 'user@discord.com'), link.replace(guildId, '@me'), link + '/extra']) {
		assert.throws(() => parseMessageLink(invalid), error => error.status === 400)
	}
})

test('builder messages round-trip with component order, values, black accent and no accent', () => {
	for (const noColor of [false, true]) {
		const original = message({ ...draft, noColor })
		const parsed = parseContainerMessage(original)
		assert.equal(parsed.noColor, noColor)
		if (!noColor) assert.equal(parsed.accentColor, '#000000')
		assert.deepEqual(buildWebContainer(parsed).components[0].toJSON(), original.components[0])
	}
})

test('unsupported layouts and properties reject the entire import', () => {
	const mutations = [
		m => { m.components.push(m.components[0]) },
		m => { m.components[0].components.push({ type: 1, components: [] }) },
		m => { m.components[0].spoiler = true },
		m => { m.components[0].components[2].items[0].description = 'alt text' },
		m => { m.components[0].components[2].items.push({ media: { url: 'https://example.com/2.png' } }) },
		m => { m.components[0].components[3].accessory.emoji = { name: '⭐' } },
		m => { m.components[0].components[3].accessory.disabled = true },
		m => { m.components[0].components[3].components.push({ type: 10, content: 'extra' }) },
		m => { m.attachments.set('file', {}) },
		m => { m.content = 'extra content' },
		m => { m.flags = new MessageFlagsBitField() }
	]
	for (const mutate of mutations) {
		const current = message()
		mutate(current)
		assert.throws(() => parseContainerMessage(current), error => error.status === 422)
	}
})

test('load returns data and revision; save updates original and refreshes revision', async () => {
	const api = routes()
	const loaded = await api.request('/api/container-message', { link })
	assert.equal(loaded.statusCode, 200)
	assert.equal(loaded.headers['Cache-Control'], 'no-store')
	assert.equal(loaded.body.source.canEdit, true)
	const revision = loaded.body.source.revision
	const saved = await api.request('/api/edit-container', {
		...draft, items: [{ type: 'text', value: 'Изменено' }], link, revision
	})
	assert.equal(saved.statusCode, 200)
	assert.equal(api.edits, 1)
	assert.equal(api.fetches, 2)
	assert.notEqual(saved.body.source.revision, revision)
	assert.deepEqual(api.editPayload.allowedMentions, { parse: [] })
	assert.equal(api.current.components[0].components[0].content, 'Изменено')
	assert.equal(api.editPayload.flags, MessageFlags.IsComponentsV2)
})

test('other authors and webhooks can be imported for copies but cannot be edited', async () => {
	for (const change of [m => { m.author.id = 'other' }, m => { m.webhookId = 'webhook' }]) {
		const api = routes()
		change(api.current)
		const loaded = await api.request('/api/container-message', { link })
		assert.equal(loaded.body.source.canEdit, false)
		const saved = await api.request('/api/edit-container', { ...draft, link, revision: loaded.body.source.revision })
		assert.equal(saved.statusCode, 403)
		assert.equal(api.edits, 0)
	}
})

test('stale revision blocks saving, including changes without a timestamp change', async () => {
	const api = routes()
	const revision = messageRevision(api.current)
	api.current.components[0].components[0].content = 'Изменено в Discord'
	const result = await api.request('/api/edit-container', { ...draft, link, revision })
	assert.equal(result.statusCode, 409)
	assert.equal(api.edits, 0)
})

test('invalid edits, unavailable bot and wrong guild do not send edits', async () => {
	const api = routes()
	const revision = messageRevision(api.current)
	for (const changes of [{ items: [] }, { items: [{ type: 'text', value: '' }] }, { revision: '' },
		{ items: [{ type: 'section', value: 'Text' }] }, { items: [{ type: 'image', value: 'invalid-url' }] }]) {
		const result = await api.request('/api/edit-container', { ...draft, link, revision, ...changes })
		assert.equal(result.statusCode, 400)
	}
	api.setReady(false)
	assert.equal((await api.request('/api/container-message', { link })).statusCode, 503)
	api.setReady(true)
	api.channel.guildId = 'wrong'
	assert.equal((await api.request('/api/container-message', { link })).statusCode, 404)
	assert.equal(api.edits, 0)
})

test('concurrent saves of one message are blocked and the lock is released', async () => {
	const api = routes()
	let release
	const gate = new Promise(resolve => { release = resolve })
	const original = api.current.edit
	api.current.edit = async payload => { await gate; return original(payload) }
	const data = { ...draft, link, revision: messageRevision(api.current) }
	const first = api.request('/api/edit-container', data)
	const second = await api.request('/api/edit-container', data)
	assert.equal(second.statusCode, 409)
	release()
	assert.equal((await first).statusCode, 200)
	assert.equal((await api.request('/api/edit-container', { ...data, revision: messageRevision(api.current) })).statusCode, 200)
})
