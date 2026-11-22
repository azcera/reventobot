import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { test } from 'node:test'
import { ChannelType, Events } from 'discord.js'
import type { Client } from 'discord.js'
import express from 'express'
import type { Pool } from 'pg'
import { WebSocket } from 'ws'
import type { MapInfo, ServerMessage } from '../shared/tactics'
import { store } from '../src/dashboard/store'
import { registerTacticsActivity } from '../src/features/tactics/activity'
import { TacticsBoard } from '../src/features/tactics/board'
import { tacticsRepository } from '../src/features/tactics/repository'

const map: MapInfo = { id: randomUUID(), name: 'Порт', width: 800, height: 600, categoryId: randomUUID() }

test('порядок карт сохраняется для всех категорий только после проверки текущего каталога', async () => {
	const firstCategory = randomUUID()
	const secondCategory = randomUUID()
	const [a, b, c, d] = Array.from({ length: 4 }, () => randomUUID())
	const updates: unknown[][] = []
	let secondIds = [c, d, randomUUID()]
	const repository = tacticsRepository({
		connect: async () => ({
			query: async (sql: string, params: unknown[]) => {
				if (sql.includes('SELECT 1 FROM tactics_categories')) return { rowCount: 1 }
				if (sql.includes('SELECT id, category_id')) return { rows: [
					...[a, b].map(id => ({ id, categoryId: firstCategory })),
					...secondIds.map(id => ({ id, categoryId: secondCategory }))
				] }
				if (sql.includes('UPDATE tactics_maps')) updates.push(params)
			},
			release() {}
		})
	} as unknown as Pool)
	const orders = [
		{ categoryId: firstCategory, previous: [a, b], ids: [b, a] },
		{ categoryId: secondCategory, previous: [c, d], ids: [d, c] }
	]
	assert.equal(await repository.reorder('guild', orders), false)
	assert.deepEqual(updates, [])
	secondIds = [c, d]
	assert.equal(await repository.reorder('guild', orders), true)
	assert.deepEqual(updates, [['guild', [firstCategory, firstCategory, secondCategory, secondCategory], [b, a, d, c], [1, 2, 1, 2]]])
})

test('доска проверяет координаты и авторство штрихов, а метки берут ник из состава', () => {
	const board = new TacticsBoard()
	board.reset(map)
	const id = randomUUID()
	const add = { type: 'stroke', id, color: '#fa5577', width: 6, point: [0.1, 0.2], epoch: 1 }
	assert.throws(() => board.edit({ ...add, point: [1.1, 0] }, 'editor', []), /Некорректное/)
	assert.throws(() => board.edit({ ...add, width: 8 }, 'editor', []), /Некорректное/)
	board.edit(add, 'editor', [])
	const points = { type: 'points', id, points: [[.4, .6]], epoch: 1 }
	assert.throws(() => board.edit(points, 'other', []), /существует/)
	assert.deepEqual(board.edit(points, 'editor', []), { type: 'points', id, points: [[.4, .6]] })
	const playerId = randomUUID()
	const place = { type: 'player', id: playerId, userId: 'player', at: [0.5, 0.5], epoch: 1, label: 'Подмена', color: '#123abc' }
	assert.throws(() => board.edit(place, 'editor', []), /покинул канал/)
	assert.deepEqual(board.edit(place, 'editor', [{ id: 'player', name: 'Игрок' }]), {
		type: 'put', object: { type: 'player', id: playerId, at: [0.5, 0.5], userId: 'player', label: 'Игрок', color: '#123abc' }
	})
	const secondId = randomUUID()
	board.edit({ ...place, id: secondId, color: '#ffffff' }, 'editor', [{ id: 'player', name: 'Игрок' }])
	board.edit({ type: 'move', id: playerId, at: [0.8, 0.3], epoch: 1 }, 'editor', [])
	board.edit({ type: 'playerColor', id: secondId, epoch: 1, color: '#4ade80' }, 'editor', [])
	assert.deepEqual(board.snapshot().objects.slice(1).map(object => object.color), ['#123abc', '#4ade80'])
	const saved = JSON.parse(JSON.stringify(board.snapshot().objects))
	board.reset(map, saved)
	assert.equal(board.dirty, false)
	assert.throws(() => board.edit(points, 'editor', []), /Доска обновилась/)
	assert.deepEqual(board.snapshot().objects, saved)
})

test('Activity изолирует комнаты, проверяет права и восстанавливает тактику из хранилища', { timeout: 15000 }, async t => {
	const appId = '100000000000000001'
	const origin = `https://${appId}.discordsays.com`
	const guildId = '100000000000000002'
	t.mock.method(store, 'roleIds', () => ['editor-role'])
	t.mock.getter(store, 'ready', () => true)
	const env = { CLIENT_ID: appId, GUILD_ID: guildId, DISCORD_CLIENT_SECRET: 'fixture-secret', TACTICS_ACTIVITY_ENABLED: 'true' }
	const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
	Object.assign(process.env, env)
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
	})
	type Role = { position: number }
	const member = (displayName: string, admin: boolean, editor: boolean, position = 0) => ({
		guild: { id: guildId }, displayName, permissions: { has: () => admin },
		roles: { cache: new Set(editor ? ['editor-role'] : []), highest: {
			position, comparePositionTo: (other: Role) => position - other.position
		} }
	})
	const members = {
		editor: member('[𝐑𝐞𝐜] Редактор | 123 / неактив', false, true, 1),
		moderator: member('Модератор', false, true, 2),
		viewer: member('Зритель', false, false),
		admin: member('Администратор', true, false),
		immune: member('Иммунитет', true, false),
		other: member('На связи', false, false)
	}
	const states = new Map(Object.entries(members).map(([id, member]) => [id, {
		id, member, channelId: id === 'admin' ? 'voice-b' : 'voice-a'
	}]))
	const guild = {
		id: guildId, available: true,
		channels: { cache: new Map(['voice-a', 'voice-b'].map(id => [id, { id, type: ChannelType.GuildVoice }])) },
		members: { cache: new Map(Object.entries(members)) }, voiceStates: { cache: states }
	}
	const client = Object.assign(new EventEmitter(), {
		isReady: () => true, guilds: { cache: new Map([[guildId, guild]]) },
		rest: { get: async (url: string) => {
			const id = url.split('/').at(-1)
			return {
				application_id: appId, instance_id: id,
				location: { guild_id: guildId, channel_id: id === 'room-a' ? 'voice-a' : 'voice-b' },
				users: id === 'room-a' ? ['editor', 'moderator', 'viewer', 'immune'] : ['admin']
			}
		} }
	})
	const tacticId = randomUUID()
	let stored: unknown
	const pool = { query: async (sql: string, params: unknown[]) => {
		assert.equal(params[0], guildId)
		if (sql.includes('INSERT INTO tactics_presets')) {
			stored = JSON.parse(String(params[4]))
			return { rows: [{ id: tacticId, name: params[3] }] }
		}
		if (sql.includes('FROM tactics_presets')) return { rows: [{ mapId: map.id, snapshot: stored }] }
		if (sql.includes('FROM tactics_maps')) return { rows: [map] }
		throw new Error('Unexpected query')
	} } as unknown as Pool
	const http = fetch
	t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
		assert.equal(url, 'https://discord.com/api/v10/oauth2/@me')
		const id = new Headers(init?.headers).get('Authorization')?.slice(7)
		return Response.json({ application: { id: appId }, user: { id } })
	})
	const app = express()
	app.use(express.json())
	const activity = registerTacticsActivity(app, client as unknown as Client, pool)
	const server = app.listen(0, '127.0.0.1')
	activity.attach(server)
	t.after(async () => {
		activity.stop()
		await new Promise<void>(resolve => server.close(() => resolve()))
	})
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	const base = `http://127.0.0.1:${address.port}`
	const redirect = await http(`${base}/activity`, { redirect: 'manual' })
	assert.equal(redirect.status, 302)
	assert.equal(redirect.headers.get('location'), '/activity/')
	const entry = await http(`${base}/activity/?frame_id=test`, { redirect: 'manual' })
	assert.equal(entry.headers.get('location'), null)
	assert.match(entry.headers.get('content-security-policy') ?? '', /frame-ancestors https:\/\/discord\.com/)
	const createSession = (user: string, instanceId: string) => http(`${base}/activity/api/session`, {
		method: 'POST',
		headers: { Origin: origin, Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ instanceId })
	})
	assert.equal((await createSession('other', 'room-a')).status, 403)
	assert.equal((await createSession('viewer', 'room-b')).status, 403)

	async function join(user: string, room: string) {
		const response = await createSession(user, room)
		assert.equal(response.status, 200)
		const { sessionToken } = await response.json()
		const socket = new WebSocket(`${base.replace('http', 'ws')}/activity/socket`, { origin })
		const inbox = new EventEmitter()
		const messages: ServerMessage[] = []
		socket.on('message', raw => {
			messages.push(JSON.parse(raw.toString()))
			inbox.emit('received')
		})
		await once(socket, 'open')
		const send = (message: object) => socket.send(JSON.stringify(message))
		send({ type: 'auth', token: sessionToken, version: 3 })
		async function read<T extends ServerMessage['type']>(type: T) {
			for (;;) {
				const index = messages.findIndex(message => message.type === type)
				if (index >= 0) return messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>
				await once(inbox, 'received', { signal: AbortSignal.timeout(2000) })
			}
		}
		return { socket, send, read }
	}
	const editor = await join('editor', 'room-a')
	const moderator = await join('moderator', 'room-a')
	const viewer = await join('viewer', 'room-a')
	const admin = await join('admin', 'room-b')
	assert.equal((await editor.read('snapshot')).canEdit, true)
	assert.deepEqual((await moderator.read('snapshot')).moderation, [{ id: 'editor', restricted: false }])
	const spectator = await viewer.read('snapshot')
	assert.equal(spectator.canEdit, false)
	assert.ok(spectator.players.some(player => player.name === 'На связи'))
	assert.equal(spectator.players.find(player => player.id === 'editor')?.name, 'Редактор')
	const adminSnapshot = await admin.read('snapshot')
	assert.equal(adminSnapshot.board.map, null)
	assert.equal(adminSnapshot.isAdmin, true)
	editor.send({ type: 'map', id: map.id, revision: 0 })
	assert.equal((await editor.read('snapshot')).board.map?.id, map.id)
	const { board } = await viewer.read('snapshot')
	assert.equal(board.map?.id, map.id)
	const strokeId = randomUUID()
	const start = { type: 'stroke', epoch: board.epoch, id: strokeId, color: '#ff0000', width: 3, point: [.5, .5] }
	editor.send({ type: 'restrict', userId: 'moderator', restricted: true })
	assert.match((await editor.read('error')).message, /Нет прав/)
	await editor.read('snapshot')
	moderator.send({ type: 'restrict', userId: 'immune', restricted: true })
	assert.match((await moderator.read('error')).message, /Нет прав/)
	moderator.send({ type: 'restrict', userId: 'editor', restricted: true })
	assert.deepEqual(await editor.read('access'), { type: 'access', canEdit: false, restricted: true, isAdmin: false, moderation: [] })
	editor.send(start)
	assert.match((await editor.read('error')).message, /запретил/)
	await editor.read('snapshot')
	moderator.send({ type: 'restrict', userId: 'editor', restricted: false })
	assert.equal((await editor.read('access')).canEdit, true)
	viewer.send(start)
	assert.match((await viewer.read('error')).message, /просмотр/)
	await viewer.read('snapshot')
	editor.send(start)
	editor.send({ type: 'points', epoch: board.epoch, id: strokeId, points: [[.7, .8]] })
	assert.equal((await viewer.read('change')).change.type, 'put')
	const appended = await viewer.read('change')
	assert.deepEqual(appended.change, { type: 'points', id: strokeId, points: [[.7, .8]] })
	assert.deepEqual((await viewer.read('cursor')).cursor, { id: 'editor', name: 'Редактор', at: [.5, .5] })
	assert.deepEqual((await viewer.read('cursor')).cursor.at, [.7, .8])
	editor.send({ type: 'undo', epoch: board.epoch })
	assert.deepEqual((await viewer.read('change')).change, { type: 'remove', id: strokeId })
	editor.send({ type: 'redo', epoch: board.epoch })
	const restored = await viewer.read('change')
	assert.deepEqual(restored.change, {
		type: 'put', object: { type: 'stroke', id: strokeId, color: '#ff0000', width: 3, points: [[.5, .5], [.7, .8]] }
	})
	const arrow = { type: 'arrow' as const, id: randomUUID(), at: [.2, .2], to: [.5, .5], color: '#ff0000', width: 3 }
	editor.send({ ...arrow, epoch: board.epoch })
	const added = await viewer.read('change')
	assert.deepEqual(added.change, { type: 'put', object: arrow })
	editor.send({ type: 'drag', epoch: board.epoch, id: arrow.id, at: [.3, .3] })
	assert.deepEqual(await viewer.read('drag'), { type: 'drag', epoch: board.epoch, id: arrow.id, at: [.3, .3] })
	editor.send({ type: 'move', epoch: board.epoch, id: arrow.id, at: [.4, .4] })
	const moved = await viewer.read('change')
	assert.equal(moved.revision, added.revision + 1)
	assert.deepEqual(moved.change, { type: 'put', object: { ...arrow, at: [.4, .4], to: [.7, .7] } })
	editor.send({ type: 'save', name: 'Подход', revision: moved.revision })
	assert.equal((await editor.read('saved')).tactic.id, tacticId)
	assert.equal((stored as { version: number }).version, 2)
	admin.send({ type: 'sync' })
	assert.equal((await admin.read('snapshot')).board.map, null)
	admin.send({ type: 'load', id: tacticId, revision: 0 })
	const loaded = (await admin.read('snapshot')).board
	assert.equal(loaded.map?.id, map.id)
	assert.deepEqual(loaded.objects[0], { type: 'stroke', id: strokeId, color: '#ff0000', width: 3, points: [[.5, .5], [.7, .8]] })
	const reconnected = await join('viewer', 'room-a')
	assert.deepEqual((await reconnected.read('snapshot')).board.objects, loaded.objects)
	activity.mapChanged(guildId, { id: map.id, map: { ...map, name: 'Новый порт' }, imageChanged: true })
	const update = await viewer.read('catalog')
	assert.equal(update.map?.name, 'Новый порт')
	assert.equal(update.imageChanged, true)
	activity.mapChanged(guildId, { mapId: map.id })
	assert.equal((await viewer.read('tactics')).mapId, map.id)
	members.editor.roles.cache.clear()
	client.emit(Events.GuildMemberUpdate, null, { guild })
	assert.equal((await editor.read('access')).canEdit, false)
	editor.send({ type: 'remove', id: strokeId, epoch: board.epoch })
	assert.match((await editor.read('error')).message, /просмотр/)
	const closed = once(viewer.socket, 'close')
	states.delete('viewer')
	client.emit(Events.VoiceStateUpdate, null, { guild })
	assert.equal((await closed)[0], 4001)
})
