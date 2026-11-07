const { randomBytes, createHash } = require('node:crypto')
const { PermissionFlagsBits } = require('discord.js')

const hash = value => createHash('sha256').update(value).digest('hex')
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(part => part.trim())
	.find(part => part.startsWith(name + '='))?.slice(name.length + 1)
const problem = (status, message) => Object.assign(new Error(message), { status })

function createAuth({ client, env = process.env, request = fetch }) {
	const sessions = new Map()
	const states = new Map()
	const attempts = new Map()
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
	const options = { httpOnly: true, secure, sameSite: 'lax', path: '/' }
	function cleanup() {
		for (const map of [sessions, states, attempts]) {
			for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key)
		}
	}
	async function authorize(userId) {
		if (!configured) throw problem(503, 'Настройте Discord OAuth2, GUILD_ID и DASHBOARD_URL в окружении сервера.')
		if (!client.isReady()) throw problem(503, 'Бот не подключён к Discord.')
		const guild = await client.guilds.fetch({ guild: env.GUILD_ID, force: true })
		await guild.roles.fetch()
		let member
		try { member = await guild.members.fetch({ user: userId, force: true }) }
		catch (error) { if (error.code === 10007) throw problem(403, 'Вы не состоите на сервере.'); throw error }
		const allowlist = (env.DASHBOARD_ALLOWED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
		if ((!member.permissions.has(PermissionFlagsBits.Administrator) && guild.ownerId !== userId) ||
			(allowlist.length && !allowlist.includes(userId))) throw problem(403, 'Доступ разрешён только администраторам этого сервера из разрешённого списка.')
		return guild
	}
	function error(res, error) {
		res.status(error.status || 503).json({ error: error.status ? error.message : 'Не удалось проверить права через Discord. Попробуйте позже.' })
	}
	function register(app) {
		app.get('/auth/status', (req, res) => res.json({ configured }))
		app.get('/auth/discord', (req, res) => {
			cleanup()
			if (!configured) return error(res, problem(503, 'Проверьте CLIENT_ID, DISCORD_CLIENT_SECRET (или CLIENT_SECRET), GUILD_ID и DASHBOARD_URL в окружении сервера.'))
			const ip = req.ip
			const attempt = attempts.get(ip) || { count: 0, expires: Date.now() + 600000 }
			attempts.set(ip, attempt)
			if (++attempt.count > 20) return error(res, problem(429, 'Слишком много попыток входа. Попробуйте через 10 минут.'))
			const state = randomBytes(32).toString('hex')
			states.set(hash(state), { expires: Date.now() + 600000 })
			res.cookie(stateCookie, state, { ...options, maxAge: 600000 })
			const query = new URLSearchParams({ client_id: env.CLIENT_ID,
				redirect_uri: origin + '/auth/discord/callback', response_type: 'code', scope: 'identify', state })
			res.redirect('https://discord.com/oauth2/authorize?' + query)
		})
		app.get('/auth/discord/callback', async (req, res) => {
			cleanup()
			const state = cookie(req, stateCookie)
			res.clearCookie(stateCookie, options)
			try {
				if (!state || state !== req.query.state || !states.delete(hash(state))) throw problem(400, 'Сессия входа истекла. Начните вход заново.')
				if (typeof req.query.code !== 'string') throw problem(400, 'Вход отменён в Discord.')
				const response = await request('https://discord.com/api/v10/oauth2/token', {
					method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: clientSecret,
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
				if (previous) sessions.delete(hash(previous))
				sessions.set(hash(id), { user: { id: user.id, name: user.global_name || user.username },
					csrf: randomBytes(32).toString('hex'), expires: Date.now() + 28800000 })
				res.cookie(sessionCookie, id, { ...options, maxAge: 28800000 })
				res.redirect('/')
			} catch (err) { res.redirect('/?error=' + encodeURIComponent(err.status ? err.message : 'Discord временно недоступен. Повторите вход.')) }
		})
	}
	async function middleware(req, res, next) {
		cleanup()
		const token = cookie(req, sessionCookie)
		const session = token && sessions.get(hash(token))
		if (!session) return error(res, problem(401, 'Войдите через Discord.'))
		if (!['GET', 'HEAD'].includes(req.method) &&
			(req.headers.origin !== new URL(origin).origin || req.headers['x-csrf-token'] !== session.csrf)) return error(res, problem(403, 'Проверка безопасности запроса не пройдена. Обновите страницу.'))
		try {
			req.guild = await authorize(session.user.id)
			req.dashboardUser = session.user
			req.csrf = session.csrf
			res.set('Cache-Control', 'no-store')
			next()
		} catch (err) {
			if (err.status === 403) { sessions.delete(hash(token)); res.clearCookie(sessionCookie, options) }
			error(res, err)
		}
	}
	function logout(req, res) {
		const token = cookie(req, sessionCookie)
		if (token) sessions.delete(hash(token))
		res.clearCookie(sessionCookie, options)
		res.json({ success: true })
	}
	return { register, middleware, logout, authorize }
}

module.exports = { createAuth, problem }
