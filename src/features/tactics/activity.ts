import { randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import path from 'node:path'
import { ChannelType, Events, PermissionFlagsBits } from 'discord.js'
import type { Client, Guild } from 'discord.js'
import express from 'express'
import type { Express, Request } from 'express'
import type { Pool } from 'pg'
import { WebSocket, WebSocketServer } from 'ws'
import type { Player, ServerMessage } from '../../../shared/tactics'
import { PUBLIC_PATH } from '../../config/path'
import { store } from '../../dashboard/store'
import { TacticsBoard, uuid } from './board'
import { tacticsRepository } from './repository'

const refreshInterval = 30_000
const accessWindow = 90_000
const roomIdleTime = 120_000
const sessionLifetime = 8 * 60 * 60_000

type Session = { room: Room; userId: string; expires: number }
type Room = {
	id: string
	guild: Guild
	channelId: string
	board: TacticsBoard
	participants: Set<string>
	verified: number
	idleSince: number
	sockets: Map<WebSocket, Session>
}
type Instance = {
	application_id: string
	instance_id: string
	location: { guild_id?: string; channel_id?: string }
	users: string[]
}

function send(socket: WebSocket, message: ServerMessage) {
	if (socket.readyState !== WebSocket.OPEN) return
	if (socket.bufferedAmount > 2_000_000) return socket.terminate()
	socket.send(JSON.stringify(message))
}

function broadcast(room: Room, message: ServerMessage) {
	for (const socket of room.sockets.keys()) send(socket, message)
}

function roster(room: Room): Player[] {
	return [...room.guild.voiceStates.cache.values()]
		.filter(state => state.channelId === room.channelId)
		.map(state => ({ id: state.id, name: state.member?.displayName ?? state.id }))
		.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

function canEnter(session: Session) {
	const { room, userId, expires } = session
	return Date.now() < expires && Date.now() - room.verified < accessWindow &&
		room.participants.has(userId) && room.guild.available &&
		room.guild.voiceStates.cache.get(userId)?.channelId === room.channelId
}

function canEdit(session: Session) {
	const member = session.room.guild.members.cache.get(session.userId)
	return !!member && store.ready && (member.permissions.has(PermissionFlagsBits.Administrator) ||
		store.roleIds('TACTICS_EDITOR_ROLES').some(id => id !== member.guild.id && member.roles.cache.has(id)))
}

function snapshot(socket: WebSocket, session: Session) {
	send(socket, {
		type: 'snapshot', board: session.room.board.snapshot(), players: roster(session.room),
		canEdit: canEdit(session)
	})
}

export function registerTacticsActivity(app: Express, client: Client, pool: Pool) {
	const appId = process.env.CLIENT_ID?.trim()
	const secret = (process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET)?.trim()
	const enabled = process.env.TACTICS_ACTIVITY_ENABLED === 'true' && !!appId && !!secret
	const origin = `https://${appId}.discordsays.com`
	const repository = tacticsRepository(pool)
	const sessions = new Map<string, Session>()
	const rooms = new Map<string, Room>()
	const ws = new WebSocketServer({ noServer: true, maxPayload: 8192 })
	const root = path.join(PUBLIC_PATH, 'activity')

	async function instance(id: string) {
		const result = await client.rest.get(`/applications/${appId}/activity-instances/${id}`) as Instance
		if (result.application_id !== appId || result.instance_id !== id ||
			result.location.guild_id !== process.env.GUILD_ID?.trim())
			throw new Error('Некорректный экземпляр Activity.')
		return result
	}

	// Express otherwise matches both /activity and /activity/ and redirects the latter to itself.
	app.get(/^\/activity$/, (_req, res) => res.redirect('/activity/'))
	app.get('/activity/api/config', (_req, res) => {
		res.set('Cache-Control', 'no-store')
		if (!enabled) return res.status(503).json({ error: 'Доска тактик ещё не включена.' })
		res.json({ appId })
	})
	app.post('/activity/api/token', async (req, res) => {
		res.set('Cache-Control', 'no-store')
		if (!enabled || !client.isReady() || !store.ready)
			return res.status(503).json({ error: 'Доска тактик недоступна.' })
		if (req.headers.origin !== origin)
			return res.status(403).json({ error: 'Откройте доску внутри Discord.' })
		const { code } = req.body ?? {}
		if (typeof code !== 'string' || code.length > 512 || !code)
			return res.status(400).json({ error: 'Некорректный запрос авторизации.' })
		try {
			const token = await fetch('https://discord.com/api/v10/oauth2/token', {
				method: 'POST',
				body: new URLSearchParams({
					client_id: appId!, client_secret: secret!, grant_type: 'authorization_code', code
				}),
				signal: AbortSignal.timeout(8000)
			})
			if (!token.ok) return res.status(401).json({ error: 'Discord отклонил авторизацию.' })
			const { access_token: accessToken } = await token.json() as { access_token: string }
			res.json({ accessToken })
		} catch {
			res.status(503).json({ error: 'Discord не ответил. Повторите вход.' })
		}
	})
	app.post('/activity/api/session', async (req, res) => {
		res.set('Cache-Control', 'no-store')
		if (!enabled || !client.isReady() || !store.ready)
			return res.status(503).json({ error: 'Доска тактик недоступна.' })
		if (req.headers.origin !== origin)
			return res.status(403).json({ error: 'Откройте доску внутри Discord.' })
		const { instanceId } = req.body ?? {}
		const authorization = req.headers.authorization ?? ''
		if (!/^Bearer [\w.~-]{1,512}$/.test(authorization) ||
			typeof instanceId !== 'string' || !/^[a-z\d-]{1,160}$/i.test(instanceId))
			return res.status(400).json({ error: 'Некорректный запрос авторизации.' })
		try {
			const tokenInfo = await fetch('https://discord.com/api/v10/oauth2/@me', {
				headers: { Authorization: authorization }, signal: AbortSignal.timeout(8000)
			})
			if (!tokenInfo.ok) return res.status(401).json({ error: 'Discord не подтвердил пользователя.' })
			const { application, user } = await tokenInfo.json() as { application: { id: string }; user?: { id: string } }
			if (application.id !== appId || !user) return res.status(403).json({ error: 'Авторизация недействительна для этой Activity.' })
			const userId = user.id
			let verified = await instance(instanceId)
			const guild = client.guilds.cache.get(verified.location.guild_id!)
			const channelId = verified.location.channel_id
			const channel = channelId && guild?.channels.cache.get(channelId)
			if (!guild?.available || !channelId || !channel || channel.type !== ChannelType.GuildVoice ||
				!verified.users.includes(userId) || guild.voiceStates.cache.get(userId)?.channelId !== channelId)
				return res.status(403).json({ error: 'Войдите в голосовой канал и присоединитесь к Activity.' })
			const missing = [...guild.voiceStates.cache.values()]
				.filter(state => state.channelId === channelId && !state.member).map(state => state.id)
			if (missing.length) {
				await guild.members.fetch({ user: missing, time: 8000 })
				verified = await instance(instanceId)
			}
			if (verified.location.channel_id !== channelId || !verified.users.includes(userId))
				return res.status(403).json({ error: 'Присоединитесь к Activity снова.' })
			let room = rooms.get(instanceId)
			if (!room) {
				room = {
					id: instanceId, guild, channelId, board: new TacticsBoard(),
					participants: new Set(), verified: 0, idleSince: Date.now(), sockets: new Map()
				}
				rooms.set(instanceId, room)
			}
			if (room.channelId !== channelId) return res.sendStatus(403)
			room.participants = new Set(verified.users)
			room.verified = Date.now()
			const sessionToken = randomBytes(32).toString('hex')
			const session = { room, userId, expires: Date.now() + sessionLifetime }
			if (!canEnter(session)) return res.status(403).json({ error: 'Голосовой канал изменился.' })
			sessions.set(sessionToken, session)
			res.json({ sessionToken })
		} catch {
			res.status(503).json({ error: 'Не удалось подтвердить запуск Activity. Повторите вход.' })
		}
	})

	function httpSession(req: Request) {
		const session = sessions.get(req.headers.authorization?.replace(/^Bearer /, '') ?? '')
		return session && canEnter(session) ? session : undefined
	}

	app.get('/activity/api/maps', async (req, res) => {
		res.set('Cache-Control', 'no-store')
		const session = httpSession(req)
		if (!session) return res.sendStatus(401)
		const cursor = uuid(req.query.cursor) ? req.query.cursor : null
		const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
		const maps = await repository.maps(session.room.guild.id, cursor, search, false)
		if (!canEnter(session)) return res.sendStatus(401)
		res.json(maps)
	})
	app.get('/activity/api/maps/:id/image', async (req, res) => {
		res.set('Cache-Control', 'no-store')
		const session = httpSession(req)
		if (!session) return res.sendStatus(401)
		if (!uuid(req.params.id)) return res.sendStatus(404)
		const image = await repository.image(session.room.guild.id, req.params.id)
		if (!canEnter(session)) return res.sendStatus(401)
		if (!image) return res.sendStatus(404)
		res.type('image/webp').send(image)
	})
	app.get('/activity/api/maps/:id/tactics', async (req, res) => {
		res.set('Cache-Control', 'no-store')
		const session = httpSession(req)
		if (!session) return res.sendStatus(401)
		if (!uuid(req.params.id)) return res.sendStatus(404)
		const presets = await repository.presets(session.room.guild.id, req.params.id)
		if (!canEnter(session)) return res.sendStatus(401)
		res.json(presets)
	})
	app.use('/activity', (_req, res, next) => {
		res.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self' wss://${appId}.discordsays.com; frame-ancestors https://discord.com https://*.discord.com; base-uri 'self'`)
		next()
	}, express.static(root))
	app.use('/activity', (_req, res) => res.sendStatus(404))

	async function edit(socket: WebSocket, session: Session, input: Record<string, unknown>) {
		const { room, userId } = session
		const { board, guild } = room
		if (!canEnter(session)) return socket.close(4001, 'Activity access expired')
		if (input.type === 'sync') return snapshot(socket, session)
		if (!canEdit(session)) throw new Error('Доступен только просмотр.')
		if (input.type === 'map' || input.type === 'load' || input.type === 'save') {
			const revision = input.revision
			const check = () => {
				if (!canEnter(session) || !canEdit(session) || socket.readyState !== WebSocket.OPEN)
					throw new Error('Доступ к редактированию изменился.')
				if (revision !== board.revision) throw new Error('Доска изменилась. Повторите действие.')
			}
			check()
			if (input.type === 'save') {
				const name = typeof input.name === 'string' ? input.name.trim() : ''
				if (!board.map || !name || name.length > 100) throw new Error('Укажите название тактики до 100 символов.')
				const mapId = board.map.id
				const tactic = await repository.save(guild.id, userId, name, board.snapshot())
				if (board.revision === revision) board.dirty = false
				broadcast(room, { type: 'saved', revision: board.revision === revision ? board.revision : -1, mapId, tactic })
				return
			}
			if (!uuid(input.id)) throw new Error('Некорректный ID.')
			const preset = input.type === 'load' ? await repository.preset(guild.id, input.id) : undefined
			if (input.type === 'load' && preset?.snapshot.version !== 1) throw new Error('Тактика недоступна.')
			const map = await repository.map(guild.id, preset?.mapId ?? input.id)
			if (!map) throw new Error('Карта недоступна.')
			check()
			board.reset(map, preset?.snapshot.objects)
			for (const [peer, peerSession] of room.sockets) snapshot(peer, peerSession)
			return
		}
		const change = board.edit(input, userId, input.type === 'player' ? roster(room) : [])
		broadcast(room, { type: 'change', change, revision: board.revision, epoch: board.epoch })
	}

	ws.on('connection', socket => {
		socket.on('error', () => socket.terminate())
		const authTimeout = setTimeout(() => socket.close(4001, 'Authentication required'), 5000)
		let session: Session | undefined
		let second = Date.now()
		let messages = 0
		let pending = false
		socket.on('message', (raw, binary) => {
			if (binary) return socket.close(1003)
			if (Date.now() - second >= 1000) {
				second = Date.now()
				messages = 0
			}
			if (++messages > 100) return socket.close(1008)
			try {
				const input = JSON.parse(raw.toString())
				if (!input || typeof input !== 'object' || Array.isArray(input)) return socket.close(1003)
				if (!session) {
					const current = input.type === 'auth' && sessions.get(input.token)
					if (!current || !canEnter(current)) return socket.close(4001, 'Authentication required')
					session = current
					clearTimeout(authTimeout)
					current.room.sockets.set(socket, current)
					snapshot(socket, current)
					return
				}
				const transaction = ['map', 'load', 'save'].includes(input.type)
				if (transaction && pending) throw new Error('Дождитесь завершения предыдущего действия.')
				if (transaction) pending = true
				void edit(socket, session, input).catch(error => {
					send(socket, { type: 'error', message: (error as { code?: unknown }).code
						? 'Не удалось выполнить действие. Повторите попытку.' : String(error.message) })
					if (canEnter(session!)) snapshot(socket, session!)
				}).finally(() => { if (transaction) pending = false })
			} catch {
				socket.close(1003)
			}
		})
		socket.on('close', () => {
			clearTimeout(authTimeout)
			if (!session) return
			session.room.sockets.delete(socket)
			if (!session.room.sockets.size) session.room.idleSince = Date.now()
		})
	})

	function refreshRoom(room: Room, players: boolean) {
		for (const [socket, session] of room.sockets) {
			if (!canEnter(session)) socket.close(4001, 'Activity access expired')
			else send(socket, { type: 'access', canEdit: canEdit(session) })
		}
		if (players) broadcast(room, { type: 'players', players: roster(room) })
	}

	const refreshAccess = setInterval(() => {
		const now = Date.now()
		for (const [id, room] of rooms) {
			if (!room.sockets.size && now - room.idleSince > roomIdleTime) rooms.delete(id)
			else refreshRoom(room, false)
		}
		for (const [token, session] of sessions)
			if (session.expires <= now || !rooms.has(session.room.id) || !session.room.participants.has(session.userId))
				sessions.delete(token)
	}, 3000).unref()
	let verifying = false
	const refreshInstances = setInterval(async () => {
		if (verifying) return
		verifying = true
		try {
			await Promise.all([...rooms.values()].map(async room => {
				try {
					const info = await instance(room.id)
					room.participants = new Set(info.location.channel_id === room.channelId ? info.users : [])
					room.verified = Date.now()
				} catch (error) {
					if ((error as { status?: number }).status === 404) room.participants.clear()
				}
				refreshRoom(room, false)
			}))
		} finally {
			verifying = false
		}
	}, refreshInterval).unref()

	const refreshGuild = (guild: Guild) => {
		for (const room of rooms.values()) if (room.guild === guild) refreshRoom(room, true)
	}
	client.on(Events.VoiceStateUpdate, (_, state) => refreshGuild(state.guild))
	client.on(Events.GuildMemberUpdate, (_, member) => refreshGuild(member.guild))
	client.on(Events.GuildMemberRemove, member => refreshGuild(member.guild))

	return {
		attach(server: Server) {
			server.on('upgrade', (req, socket, head) => {
				if (!enabled || req.url !== '/activity/socket' || req.headers.origin !== origin) return socket.destroy()
				ws.handleUpgrade(req, socket, head, connection => ws.emit('connection', connection))
			})
		},
		stop() {
			clearInterval(refreshAccess)
			clearInterval(refreshInstances)
			for (const socket of ws.clients) socket.terminate()
			ws.close()
		}
	}
}
