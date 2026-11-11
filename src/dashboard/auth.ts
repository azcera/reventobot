import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { randomBytes, createHash } from 'node:crypto'
import { PermissionFlagsBits } from 'discord.js'
import { createSessions } from './sessions'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const cookie = (req: E.Request, name: string) => (req.headers.cookie || '').split(';').map(part => part.trim())
	.find(part => part.startsWith(name + '='))?.slice(name.length + 1)
const problem = (status: number, message: string) => Object.assign(new Error(message), { status })

function createAuth({ client, pool, env = process.env, request = fetch }: { client: D.Client; pool?: Pg.Pool; env?: T.Env; request?: typeof fetch }) {
	const sessions = createSessions(pool, { clientId: env.CLIENT_ID, guildId: env.GUILD_ID })
	const states = new Map<string, { expires: number }>()
	const attempts = new Map<string, { expires: number; count: number }>()
	const clientSecret = env.DISCORD_CLIENT_SECRET || env.CLIENT_SECRET
	const origin = (env.DASHBOARD_URL || 'http://localhost:3000').replace(/\/+$/, '')
	const secure = origin.startsWith('https://')
	const sessionCookie = secure ? '__Host-revento' : 'revento'
	const stateCookie = secure ? '__Host-revento-oauth' : 'revento-oauth'
	let validOrigin = false
	try {
		const url = new URL(origin)
		validOrigin = url.origin === origin && !url.username && !url.password &&
			(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
	} catch {}
	const configured = Boolean(env.CLIENT_ID && clientSecret && env.GUILD_ID && validOrigin)
	const options = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' }
	function cleanup() {
		for (const map of [states, attempts]) {
			for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key)
		}
	}
	async function authorize(userId: string) {
		if (!configured) throw problem(503, 'Настройте Discord OAuth2, GUILD_ID и DASHBOARD_URL в окружении сервера.')
		if (!client.isReady()) throw problem(503, 'Бот не подключён к Discord.')
		const guild = await client.guilds.fetch({ guild: env.GUILD_ID!, force: true })
		await guild.roles.fetch()
		let member
		try { member = await guild.members.fetch({ user: userId, force: true }) }
		catch (caughtError) {
 const error = getError(caughtError)
 if (error.code === 10007) throw problem(403, 'Вы не состоите на сервере.'); throw error }
		const allowlist = (env.DASHBOARD_ALLOWED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
		if ((!member.permissions.has(PermissionFlagsBits.Administrator) && guild.ownerId !== userId) ||
			(allowlist.length && !allowlist.includes(userId))) throw problem(403, 'Доступ разрешён только администраторам этого сервера из разрешённого списка.')
		return guild
	}
	function error(res: E.Response, error: Error & { status?: number }) {
		res.status(error.status || 503).json({ error: error.status ? error.message : 'Не удалось проверить права через Discord. Попробуйте позже.' })
	}
	function register(app: E.Express) {
		app.get('/auth/status', (req: E.Request, res: E.Response) => res.json({ configured }))
		app.get('/auth/discord', (req: E.Request, res: E.Response) => {
			cleanup()
			if (!configured) return error(res, problem(503, 'Проверьте CLIENT_ID, DISCORD_CLIENT_SECRET (или CLIENT_SECRET), GUILD_ID и DASHBOARD_URL в окружении сервера.'))
			const ip = req.ip || 'unknown'
			const attempt = attempts.get(ip) || { count: 0, expires: Date.now() + 600000 }
			attempts.set(ip, attempt)
			if (++attempt.count > 20) return error(res, problem(429, 'Слишком много попыток входа. Попробуйте через 10 минут.'))
			const state = randomBytes(32).toString('hex')
			states.set(hash(state), { expires: Date.now() + 600000 })
			res.cookie(stateCookie, state, { ...options, maxAge: 600000 })
			const query = new URLSearchParams({ client_id: env.CLIENT_ID!,
				redirect_uri: origin + '/auth/discord/callback', response_type: 'code', scope: 'identify', state })
			res.redirect('https://discord.com/oauth2/authorize?' + query)
		})
		app.get('/auth/discord/callback', async (req: E.Request, res: E.Response) => {
			cleanup()
			const state = cookie(req, stateCookie)
			res.clearCookie(stateCookie, options)
			try {
				if (!state || state !== req.query.state || !states.delete(hash(state))) throw problem(400, 'Сессия входа истекла. Начните вход заново.')
				if (typeof req.query.code !== 'string') throw problem(400, 'Вход отменён в Discord.')
				const response = await request('https://discord.com/api/v10/oauth2/token', {
					method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ client_id: env.CLIENT_ID!, client_secret: clientSecret!,
						grant_type: 'authorization_code', code: req.query.code, redirect_uri: origin + '/auth/discord/callback' }),
					signal: AbortSignal.timeout(15000)
				})
				if (!response.ok) throw problem(502, 'Discord не подтвердил вход. Попробуйте заново.')
				const token = await response.json()
				const profile = await request('https://discord.com/api/v10/users/@me', {
					headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000)
				})
				if (!profile.ok) throw problem(502, 'Не удалось получить профиль Discord.')
				const user = await profile.json()
				await authorize(user.id)
				const id = randomBytes(32).toString('hex')
				const previous = cookie(req, sessionCookie)
				await sessions.set(hash(id), { user: { id: user.id, name: user.global_name || user.username },
					csrf: randomBytes(32).toString('hex'), expires: Date.now() + 28800000 })
				if (previous) await sessions.delete(hash(previous))
				res.cookie(sessionCookie, id, { ...options, maxAge: 28800000 })
				res.redirect('/')
			} catch (caughtError) {
 const err = getError(caughtError)
 res.redirect('/?error=' + encodeURIComponent(err.status ? err.message : 'Discord временно недоступен. Повторите вход.')) }
		})
	}
	async function middleware(req: E.Request, res: E.Response, next: E.NextFunction) {
		cleanup()
		const token = cookie(req, sessionCookie)
		let session
		try { session = token && await sessions.get(hash(token!)) }
		catch { return error(res, problem(503, 'Не удалось проверить сессию. Проверьте подключение к базе и повторите запрос.')) }
		if (!session) return error(res, problem(401, 'Войдите через Discord.'))
		if (!['GET', 'HEAD'].includes(req.method) &&
			(req.headers.origin !== new URL(origin).origin || req.headers['x-csrf-token'] !== session.csrf)) return error(res, problem(403, 'Проверка безопасности запроса не пройдена. Обновите страницу.'))
		try {
			req.guild = await authorize(session.user.id)
			req.dashboardUser = session.user
			req.csrf = session.csrf
			res.set('Cache-Control', 'no-store')
			next()
		} catch (caughtError) {
 const err = getError(caughtError)

			if (err.status === 403) {
				try { await sessions.delete(hash(token!)) } catch { return error(res, problem(503, 'Не удалось отозвать сессию. Повторите запрос.')) }
				res.clearCookie(sessionCookie, options)
			}
			error(res, err)
		}
	}
	async function logout(req: E.Request, res: E.Response) {
		const token = cookie(req, sessionCookie)
		try { if (token) await sessions.delete(hash(token!)) }
		catch { return error(res, problem(503, 'Не удалось завершить сессию. Повторите выход.')) }
		res.clearCookie(sessionCookie, options)
		res.json({ success: true })
	}
	return { register, middleware, logout, authorize }
}

export { createAuth, problem }
