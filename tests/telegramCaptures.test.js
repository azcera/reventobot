const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

test('Telegram capture listener parses attack and defence messages and deduplicates announcements', async () => {
	const eventPath = require.resolve('../src/events/telegramCaptures')
	const servicePath = require.resolve('../src/services/telegramService')
	const storePath = require.resolve('../src/dashboard/store')
	const savedEvent = require.cache[eventPath]
	const savedService = require.cache[servicePath]
	const savedStore = require.cache[storePath]
	const savedTimeout = global.setTimeout
	const Module = require('node:module')
	const originalLoad = Module._load
	const channels = []
	const telegram = { addEventHandler(handler, filter) { this.handler = handler; this.filter = filter } }
	const channel = { send: async payload => channels.push(payload) }
	const config = { getSetting: key => key === 'CAPT_INFO_CHANNEL_ID' ? 'capture-announcements' : null }
	try {
		require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: { initTelegramClient: async () => telegram } }
		require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { store: config } }
		global.setTimeout = () => 1
		Module._load = function (request, parent, isMain) {
			if (request === 'teleproto/events') return { NewMessage: class NewMessage {} }
			return originalLoad.call(this, request, parent, isMain)
		}
		delete require.cache[eventPath]
		const client = new EventEmitter()
		client.channels = { fetch: async id => { assert.equal(id, 'capture-announcements'); return channel } }
		require('../src/events/telegramCaptures')(client)
		client.emit('clientReady', { user: { tag: 'test' } })
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(typeof telegram.handler, 'function')

		const event = (senderId, text) => ({ message: { senderId: { toString: () => senderId }, text } })
		const attack = 'Ваша организация REVENTO напала на Enemy_Name-X!\nНачало: 09.11.2026 18:30\nНазвание квадрата: Палето\nНомер квадрата: 12\nКоличество нападающих: 10'
		await telegram.handler(event('6204267987', attack))
		await telegram.handler(event('6204267987', attack))
		await telegram.handler(event('6204267987', 'На вашу организацию REVENTO напали Нейтрал Squad!'))
		const defend = 'На вашу организацию REVENTO напали Enemy_Name-X!\nНачало: 09.11.2026 19:00\nНазвание квадрата: Палето\nНомер квадрата: 13\nКоличество нападающих: 8'
		await telegram.handler(event('6204267987', defend))
		await telegram.handler(event('other', attack))

		assert.equal(channels.length, 2)
		const payload = channels.map(item => JSON.stringify(item.components.map(component => component.toJSON())))
		assert.match(payload[0], /Против: `Enemy_Name-X`/)
		assert.match(payload[0], /capt_tg_RW5lbXlfTmFtZS1Y_09\.11\.2026-18:30/)
		assert.match(payload[0], /Создать регу на АТАКУ/)
		assert.match(payload[1], /КАПТ ЗАЩИТА/)
		assert.match(payload[1], /capt_tg_RW5lbXlfTmFtZS1Y_09\.11\.2026-19:00/)
		assert.match(payload[1], /Создать регу на ЗАЩИТУ/)

		const ownAttack = attack.replace('Номер квадрата: 12', 'Номер квадрата: 14')
		await telegram.handler({ message: { senderId: 'self', out: true, peerId: { userId: '6204267987' }, text: ownAttack } })
		await telegram.handler({ message: { senderId: 'self', out: true, peerId: { userId: 'other' }, text: ownAttack.replace('14', '15') } })
		await telegram.handler({ message: { senderId: 'other', out: false, peerId: { userId: '6204267987' }, text: ownAttack.replace('14', '16') } })
		assert.equal(channels.length, 2)
	} finally {
		global.setTimeout = savedTimeout
		Module._load = originalLoad
		if (savedEvent) require.cache[eventPath] = savedEvent
		else delete require.cache[eventPath]
		if (savedService) require.cache[servicePath] = savedService
		else delete require.cache[servicePath]
		if (savedStore) require.cache[storePath] = savedStore
		else delete require.cache[storePath]
	}
})

test('ready does not initialize the API-backed Family Wars service', async () => {
	const readyPath = require.resolve('../src/events/ready')
	const warsPath = require.resolve('../src/services/familyWars')
	const savedReady = require.cache[readyPath]
	const savedWars = require.cache[warsPath]
	const dependencyExports = {
		'../features/archive/updateLists': { updateLists: async () => {} },
		'../services/majesticSync': { createMajesticSync: () => ({}) },
		'../services/majesticNicknameScheduler': { createMajesticNicknameScheduler: () => ({ start() {} }) },
		'../services/familyMembership': { createFamilyMembership: () => ({ start() {} }) },
		'../dashboard/store': { store: {} },
		'../services/database': {},
		'../services/eventSchedule': { createEventSchedule: () => ({ start: async () => {} }) },
		'../services/adminApplicationCommands': { registerAdminApplicationCommands: async () => {} }
	}
	const dependencyCache = new Map()
	const path = require('node:path')
	const readyDirectory = path.dirname(readyPath)
	let apiServiceCreated = false
	try {
		for (const [request, exports] of Object.entries(dependencyExports)) {
			const dependencyPath = require.resolve(path.join(readyDirectory, request))
			dependencyCache.set(dependencyPath, require.cache[dependencyPath])
			require.cache[dependencyPath] = { id: dependencyPath, filename: dependencyPath, loaded: true, exports }
		}
		require.cache[warsPath] = { id: warsPath, filename: warsPath, loaded: true, exports: {
			createFamilyWars: () => { apiServiceCreated = true; return { start() {} } }
		} }
		delete require.cache[readyPath]
		const client = new EventEmitter()
		client.guilds = { cache: new Map() }
		require('../src/events/ready')(client)
		client.emit('clientReady', { user: { tag: 'test' } })
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(apiServiceCreated, false)
	} finally {
		if (savedReady) require.cache[readyPath] = savedReady
		else delete require.cache[readyPath]
		if (savedWars) require.cache[warsPath] = savedWars
		else delete require.cache[warsPath]
		for (const [path, cached] of dependencyCache) {
			if (cached) require.cache[path] = cached
			else delete require.cache[path]
		}
	}
})

test('Telegram capture button preserves the encoded target and start time', async () => {
	const interactionsPath = require.resolve('../src/features/capture/captureInteractions')
	const managerPath = require.resolve('../src/features/capture/captureManager')
	const storePath = require.resolve('../src/dashboard/store')
	const dbPath = require.resolve('../src/services/database')
	const savedInteractions = require.cache[interactionsPath]
	const savedManager = require.cache[managerPath]
	const savedStore = require.cache[storePath]
	const savedDb = require.cache[dbPath]
	const savedTimeout = global.setTimeout
	const calls = []
	const store = { roleIds: () => [] }
	try {
		require.cache[managerPath] = { id: managerPath, filename: managerPath, loaded: true, exports: {
			sendCollection: async (...args) => calls.push(args)
		} }
		require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { store } }
		require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} }
		global.setTimeout = () => 1
		delete require.cache[interactionsPath]
		const { handleAutoCaptButton } = require('../src/features/capture/captureInteractions')
		const interaction = {
			customId: 'capt_tg_RW5lbXlfTmFtZS1Y_09.11.2026-18:30',
			member: { roles: { cache: { some: () => false } }, permissions: { has: () => true } },
			deferReply: async () => {}, editReply: async () => {}, deleteReply: async () => {}
		}
		await handleAutoCaptButton(interaction)
		assert.equal(calls.length, 1)
		assert.equal(calls[0][2], 'капт против Enemy_Name-X')
		assert.equal(calls[0][1], '<t:1794238200:t>')
		assert.equal(calls[0][3], 20)
	} finally {
		global.setTimeout = savedTimeout
		if (savedInteractions) require.cache[interactionsPath] = savedInteractions
		else delete require.cache[interactionsPath]
		if (savedManager) require.cache[managerPath] = savedManager
		else delete require.cache[managerPath]
		if (savedStore) require.cache[storePath] = savedStore
		else delete require.cache[storePath]
		if (savedDb) require.cache[dbPath] = savedDb
		else delete require.cache[dbPath]
	}
})
