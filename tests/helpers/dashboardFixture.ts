import express = require('express')
import http = require('node:http')
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { RequestHandler } from 'express'
import { Collection, MessageFlagsBitField, MessageFlags } from 'discord.js'
const { createAuth } = require('../../src/dashboard/auth')
const { registerDashboard } = require('../../src/dashboard/routes')
const { store } = require('../../src/dashboard/store')
const { registerContainerMessageRoutes } = require('../../src/services/containerMessageService')

type MemoryState = { revision: number; value: { templates: Record<string, unknown>; settings: Record<string, unknown> } }
type SessionRow = { client_id: unknown; guild_id: unknown; user_data: unknown; csrf: unknown; expires_at: string }
type NavigationRow = { message_id: unknown; guild_id: unknown; channel_id: unknown; container_index: unknown; prefix_length: unknown }
type AuditRow = { id: number; created_at: string; actor: unknown; action: unknown; target: unknown; details: unknown }
type MessageComponent = { type: number; content?: string; accent_color?: number | null; components?: MessageComponent[]; accessory?: MessageComponent; items?: { media: { url: string }; description: string }[]; style?: number; custom_id?: string; label?: string; disabled?: boolean }
type EditPayload = { components: MessageComponent[] }
interface FixtureMessage {
 id: string; channelId: string; author: { id: string }; webhookId: null; url: string; content: string; editedTimestamp: number | null;
 flags: MessageFlagsBitField; embeds: unknown[]; attachments: Collection<string, { id: string }>;
 components: MessageComponent[]; lastPayload?: EditPayload; edit(payload: EditPayload): Promise<FixtureMessage>
}
interface FixtureChannel {
 id: string; guildId: string; name: string; type: number; guild?: unknown;
 isTextBased(): boolean; permissionsFor(): { has(): boolean }; messages: { fetch(): Promise<FixtureMessage> }
}
function memoryPool() {
 let state: MemoryState = { revision: 0, value: { templates: {}, settings: {} } }
 let backup = structuredClone(state)
 const history: AuditRow[] = []
 const dynamic = new Set<string>()
 const queries: string[] = []
 const navigation = new Map<unknown, NavigationRow>()
 const sessions = new Map<unknown, SessionRow>()
 const query = async (sql: string, params: readonly unknown[] = []) => {
		queries.push(sql)
		if (sql.startsWith('INSERT INTO dashboard_sessions ')) sessions.set(params[0], { client_id: params[1], guild_id: params[2], user_data: JSON.parse(String(params[3])), csrf: params[4], expires_at: String(params[5]) })
		if (sql.startsWith('SELECT user_data, csrf, expires_at FROM dashboard_sessions')) {
			const session = sessions.get(params[0])
			return { rows: session && session.client_id === params[1] && session.guild_id === params[2] && new Date(session.expires_at).getTime() > Date.now() ? [structuredClone(session)] : [] }
		}
		if (sql.startsWith('DELETE FROM dashboard_sessions WHERE expires_at')) { for (const [id, value] of sessions) if (new Date(value.expires_at).getTime() <= Date.now()) sessions.delete(id) }
		if (sql.startsWith('DELETE FROM dashboard_sessions WHERE token_hash')) { const session = sessions.get(params[0]); if (session?.client_id === params[1] && session?.guild_id === params[2]) sessions.delete(params[0]) }
		if (sql.startsWith('INSERT INTO dashboard_navigation_messages')) navigation.set(params[0], { message_id: params[0], guild_id: params[1], channel_id: params[2], container_index: params[3], prefix_length: params[4] })
		if (sql.startsWith('SELECT * FROM dashboard_navigation_messages')) return { rows: [...navigation.values()].filter(row => row.guild_id === params[0]) }
		if (sql.startsWith('DELETE FROM dashboard_navigation_messages')) navigation.delete(params[0])
		if (sql === 'BEGIN') backup = structuredClone(state)
		if (sql === 'ROLLBACK') state = backup
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(state)] }
		if (sql.startsWith('UPDATE dashboard_state')) { state.value = JSON.parse(String(params[0])); state.revision++ }
		if (sql.startsWith('INSERT INTO dashboard_audit')) history.unshift({ id: history.length + 1, created_at: new Date().toISOString(), actor: params[0], action: params[1], target: params[2], details: params[3] })
		if (sql.startsWith('SELECT id, created_at')) return { rows: structuredClone(history) }
		if (sql.includes('to_regclass')) return { rows: [{ name: null }] }
		if (sql.includes('SELECT 1 FROM active_captures')) return { rows: dynamic.has(String(params[0])) ? [{}] : [] }
		return { rows: [] }
	}
	return { query, connect: async () => ({ query, release() {} }), dynamic, queries, sessions }
}

async function createFixture({ secretKey = 'DISCORD_CLIENT_SECRET' } = {}) {
	const app = express()
	app.use(express.json())
	const server = http.createServer(app).listen(0, '127.0.0.1')
	await once(server, 'listening')
	const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
	const guildId = '111111111111111111'
	const channelId = '222222222222222222'
	const userId = '333333333333333333'
	const messageId = '444444444444444444'
	const env = { CLIENT_ID: 'client', [secretKey]: 'secret', DASHBOARD_URL: origin, GUILD_ID: guildId }
	let isAdmin = true
	const message: FixtureMessage = {
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
	const channel: FixtureChannel = { id: channelId, guildId, name: 'общий', type: 0, isTextBased: () => true,
		permissionsFor: () => ({ has: () => true }), messages: { fetch: async () => message } }
	const guild = { id: guildId, name: 'REVENTO', ownerId: 'owner',
		roles: { fetch: async () => {}, cache: new Collection([['role', { id: 'role', name: 'Участник', position: 1 }]]) },
		members: { fetch: async () => ({ permissions: { has: () => isAdmin } }) },
		channels: { fetch: async (id?: string) => id ? channel : new Collection([[channelId, channel]]) }
	}
	channel.guild = guild
	const client = { isReady: () => true, user: { id: 'bot' }, guilds: { fetch: async () => guild },
		channels: { fetch: async (id: string) => id === channelId ? channel : { guildId: 'other' } }, ws: { ping: 42 }, uptime: 60000 }
	const pool = memoryPool()
	await store.init(pool)
	let tokenCalls = 0
	const oauthTokens: Record<string, string>[] = []
	const authOptions = { client, env, pool, request: async (url: string, options: { body: URLSearchParams }) => {
		if (url.endsWith('/token')) { tokenCalls++; oauthTokens.push(Object.fromEntries(options.body)); return { ok: true, json: async () => ({ access_token: 'oauth-token' }) } }
		return { ok: true, json: async () => ({ id: userId, username: 'Test Admin', global_name: 'Администратор' }) }
	} }
	let auth = createAuth(authOptions)
	registerDashboard(app, client, pool, { auth: { register: (app: express.Express) => auth.register(app), middleware: (...args: Parameters<RequestHandler>) => auth.middleware(...args), logout: (...args: Parameters<RequestHandler>) => auth.logout(...args) } })
	registerContainerMessageRoutes(app, client)
	app.post('/api/echo', (req, res) => res.json({ success: true }))
	app.get('/api/channel-info', (req, res) => res.json({ success: true }))
	let jar = ''
	let csrf: string | undefined
	async function request(path: string, { body, headers = {}, method }: { body?: unknown; headers?: Record<string, string>; method?: string } = {}) {
		const response = await fetch(origin + path, { redirect: 'manual', method: method || (body === undefined ? 'GET' : 'POST'),
			headers: { ...(jar ? { Cookie: jar } : {}), ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }), ...headers },
			body: body === undefined ? undefined : JSON.stringify(body) })
		return response
	}
	async function login() {
		const start = await request('/auth/discord')
		const state = new URL(start.headers.get('location')!).searchParams.get('state')
		const stateCookie = start.headers.getSetCookie().find(value => value.startsWith('revento-oauth='))
		if (!stateCookie) throw new Error('OAuth state cookie missing')
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
		restartAuth() { auth = createAuth(authOptions) },
		get csrf() { return csrf }, get tokenCalls() { return tokenCalls }, get cookie() { return jar }, setAdmin(value: boolean) { isAdmin = value },
		async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}

export { memoryPool, createFixture }
