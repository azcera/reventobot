const express = require('express')
const http = require('node:http')
const { once } = require('node:events')
const { Collection, MessageFlagsBitField, MessageFlags } = require('discord.js')
const { createAuth } = require('../../src/dashboard/auth')
const { registerDashboard } = require('../../src/dashboard/routes')
const { store } = require('../../src/dashboard/store')
const { registerContainerMessageRoutes } = require('../../src/services/containerMessageService')

function memoryPool() {
	let state = { revision: 0, value: { templates: {}, settings: {} } }
	let backup
	const history = []
	const dynamic = new Set()
	const queries = []
	const navigation = new Map()
	const query = async (sql, params = []) => {
		queries.push(sql)
		if (sql.startsWith('INSERT INTO dashboard_navigation_messages')) navigation.set(params[0], { message_id: params[0], guild_id: params[1], channel_id: params[2], container_index: params[3], prefix_length: params[4] })
		if (sql.startsWith('SELECT * FROM dashboard_navigation_messages')) return { rows: [...navigation.values()].filter(row => row.guild_id === params[0]) }
		if (sql.startsWith('DELETE FROM dashboard_navigation_messages')) navigation.delete(params[0])
		if (sql === 'BEGIN') backup = structuredClone(state)
		if (sql === 'ROLLBACK') state = backup
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(state)] }
		if (sql.startsWith('UPDATE dashboard_state')) { state.value = JSON.parse(params[0]); state.revision++ }
		if (sql.startsWith('INSERT INTO dashboard_audit')) history.unshift({ id: history.length + 1, created_at: new Date().toISOString(), actor: params[0], action: params[1], target: params[2], details: params[3] })
		if (sql.startsWith('SELECT id, created_at')) return { rows: structuredClone(history) }
		if (sql.includes('to_regclass')) return { rows: [{ name: null }] }
		if (sql.includes('SELECT 1 FROM active_captures')) return { rows: dynamic.has(params[0]) ? [{}] : [] }
		return { rows: [] }
	}
	return { query, connect: async () => ({ query, release() {} }), dynamic, queries }
}

async function createFixture({ secretKey = 'DISCORD_CLIENT_SECRET' } = {}) {
	const app = express()
	app.use(express.json())
	const server = http.createServer(app).listen(0, '127.0.0.1')
	await once(server, 'listening')
	const origin = 'http://127.0.0.1:' + server.address().port
	const guildId = '111111111111111111'
	const channelId = '222222222222222222'
	const userId = '333333333333333333'
	const messageId = '444444444444444444'
	const env = { CLIENT_ID: 'client', [secretKey]: 'secret', DASHBOARD_URL: origin, GUILD_ID: guildId }
	let isAdmin = true
	const message = {
		id: messageId, channelId, author: { id: 'bot' }, webhookId: null,
		url: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`, content: '', editedTimestamp: null,
		flags: new MessageFlagsBitField(MessageFlags.IsComponentsV2), embeds: [], attachments: new Collection([['attachment', { id: 'attachment' }]]),
		components: [{ type: 17, accent_color: null, components: [
			{ type: 10, content: '## Исходный заголовок' },
			{ type: 9, components: [{ type: 10, content: 'Текст секции' }], accessory: { type: 2, style: 1, custom_id: 'open_invite_modal', label: 'Подать заявку', disabled: false } },
			{ type: 12, items: [{ media: { url: 'attachment://banner.png' }, description: 'Баннер' }] }
		] }],
		async edit(payload) { this.lastPayload = payload; this.components = payload.components; this.editedTimestamp = (this.editedTimestamp || 0) + 1; return this }
	}
	const channel = { id: channelId, guildId, name: 'общий', type: 0, isTextBased: () => true,
		permissionsFor: () => ({ has: () => true }), messages: { fetch: async () => message } }
	const guild = { id: guildId, name: 'REVENTO', ownerId: 'owner',
		roles: { fetch: async () => {}, cache: new Collection([['role', { id: 'role', name: 'Участник', position: 1 }]]) },
		members: { fetch: async () => ({ permissions: { has: () => isAdmin } }) },
		channels: { fetch: async id => id ? channel : new Collection([[channelId, channel]]) }
	}
	channel.guild = guild
	const client = { isReady: () => true, user: { id: 'bot' }, guilds: { fetch: async () => guild },
		channels: { fetch: async id => id === channelId ? channel : { guildId: 'other' } }, ws: { ping: 42 }, uptime: 60000 }
	const pool = memoryPool()
	await store.init(pool)
	let tokenCalls = 0
	const oauthTokens = []
	const auth = createAuth({ client, env, request: async (url, options) => {
		if (url.endsWith('/token')) { tokenCalls++; oauthTokens.push(Object.fromEntries(options.body)); return { ok: true, json: async () => ({ access_token: 'oauth-token' }) } }
		return { ok: true, json: async () => ({ id: userId, username: 'Test Admin', global_name: 'Администратор' }) }
	} })
	registerDashboard(app, client, pool, { auth })
	registerContainerMessageRoutes(app, client)
	app.post('/api/echo', (req, res) => res.json({ success: true }))
	app.get('/api/channel-info', (req, res) => res.json({ success: true }))
	let jar = ''
	let csrf
	async function request(path, { body, headers = {}, method } = {}) {
		const response = await fetch(origin + path, { redirect: 'manual', method: method || (body === undefined ? 'GET' : 'POST'),
			headers: { ...(jar ? { Cookie: jar } : {}), ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }), ...headers },
			body: body === undefined ? undefined : JSON.stringify(body) })
		return response
	}
	async function login() {
		const start = await request('/auth/discord')
		const state = new URL(start.headers.get('location')).searchParams.get('state')
		const stateCookie = start.headers.getSetCookie().find(value => value.startsWith('revento-oauth='))
		jar = stateCookie.split(';')[0]
		const response = await request('/auth/discord/callback?code=code&state=' + state)
		const sessionCookie = response.headers.getSetCookie().find(value => value.startsWith('revento='))
		if (sessionCookie) {
			jar = sessionCookie.split(';')[0]
			csrf = (await (await request('/api/session')).json()).csrf
		}
		return response
	}
	return { app, server, origin, request, login, env, pool, client, guild, channel, message, userId, channelId, oauthTokens,
		get csrf() { return csrf }, get tokenCalls() { return tokenCalls }, get cookie() { return jar }, setAdmin(value) { isAdmin = value },
		async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}

module.exports = { memoryPool, createFixture }
