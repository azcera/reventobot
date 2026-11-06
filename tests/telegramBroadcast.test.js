const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { getChannels, prepareMessage, createBroadcastService } = require('../src/services/telegramBroadcastService')
const { discordNotificationContent } = require('../src/utils/discordNotificationContent')

function message(content = 'Объявление', channelId = 'public') {
	return {
		content, channelId, channel: { name: channelId }, author: { tag: 'author', bot: false },
		url: `https://discord.com/channels/server/${channelId}/message`,
		embeds: [], attachments: new Map()
	}
}

function fixture() {
	const subscribers = new Map()
	const hashes = new Set()
	const jobs = []
	const calls = []
	let failure
	let nextId = 0
	const queries = []
	const pool = {
		async query(sql, params = []) {
			queries.push([sql, params])
			if (sql.includes('SELECT update_offset')) return { rows: [{ update_offset: '123' }] }
			if (sql.includes('INSERT INTO telegram_broadcast_subscribers')) subscribers.set(params[0], params[1])
			if (sql.includes('INSERT INTO telegram_broadcast_dedup (hash')) {
				if (hashes.has(params[0])) return { rows: [] }
				hashes.add(params[0])
				return { rows: [{ hash: params[0] }] }
			}
			if (sql.includes('INSERT INTO telegram_broadcast_queue')) {
				for (const [chat_id, active] of subscribers) {
					if (active) jobs.push({ id: ++nextId, chat_id, parts: JSON.parse(params[0]), next_part: 0, attempts: 0 })
				}
			}
			if (sql.includes('SELECT q.*')) return { rows: jobs.filter(job => subscribers.get(job.chat_id)).slice(0, 1) }
			if (sql.includes('SET active = FALSE')) subscribers.set(params[0], false)
			if (sql.includes('DELETE FROM telegram_broadcast_queue')) {
				for (let i = jobs.length - 1; i >= 0; i--) {
					if (sql.includes('chat_id') ? jobs[i].chat_id === params[0] : jobs[i].id === params[0]) jobs.splice(i, 1)
				}
			}
			if (sql.includes('SET next_part =')) jobs.find(job => job.id === params[0]).next_part++
			if (sql.includes('SET attempts =')) jobs.find(job => job.id === params[0]).attempts++
			return { rows: [] }
		},
		async connect() { return { query: pool.query, release() {} } }
	}
	const request = async (url, options) => {
		calls.push({ method: url.split('/').pop(), ...JSON.parse(options.body) })
		const error = failure
		failure = undefined
		return { ok: !error, status: error || 200, json: async () => error
			? { ok: false, error_code: error } : { ok: true, result: {} } }
	}
	const service = createBroadcastService({ pool, token: 'test', request })
	return { service, pool, subscribers, hashes, jobs, calls, queries, fail: code => { failure = code } }
}

test('channel configuration excludes private channel even if explicitly listed', () => {
	assert.deepEqual([...getChannels({ DISCORD_NOTIFICATION_CHANNEL_IDS: ' public, private, public, ,other ',
		DISCORD_NOTIFICATION_CHANNEL_ID: 'private' })], ['public', 'other'])
})

test('fingerprint ignores source and author, preserves meaningful content', () => {
	const a = message(' Test\r\ntext ')
	const b = message('Test\ntext', 'other')
	b.author.tag = 'another author'
	assert.equal(prepareMessage(a).hash, prepareMessage(b).hash)
	assert.notEqual(prepareMessage(a).hash, prepareMessage(message('Different')).hash)
	assert.equal(prepareMessage(message('')), null)
})

test('notification template uses server nickname and falls back to Discord names', () => {
	const value = message('Текст сообщения', 'объявления')
	value.member = { displayName: 'Ник на сервере' }
	value.author.globalName = 'Отображаемое имя'
	value.author.username = 'username'
	assert.equal(prepareMessage(value).parts.join(''),
		'📣 Канал: #объявления\n👤 Отправил: Ник на сервере\n\nТекст сообщения')
	value.member = null
	assert.match(prepareMessage(value).parts[0], /Отправил: Отображаемое имя/)
	value.author.globalName = null
	assert.match(prepareMessage(value).parts[0], /Отправил: username/)
	value.author.username = undefined
	assert.match(prepareMessage(value).parts[0], /Отправил: author/)
})

test('embeds, attachments and component text are forwarded and affect fingerprint', () => {
	const value = message('')
	value.embeds = [{ title: 'Title', description: 'Body', fields: [{ name: 'Field', value: 'Value' }] }]
	value.attachments.set('file', { url: 'https://example.com/file.png' })
	value.components = [{ components: [{ content: 'Component text' }] }]
	const result = prepareMessage(value)
	assert.match(result.parts.join(''), /Title\nBody\nField\nValue\nComponent text\n\[Изображение\]/)
	assert.ok(!result.parts.join('').includes('https://example.com/file.png'))
	value.attachments.clear()
	assert.notEqual(result.hash, prepareMessage(value).hash)
})

test('media become labels while typed text and ordinary links remain intact', () => {
	const value = message('Текст https://example.com/page')
	value.attachments = new Map([
		['image', { contentType: 'image/png', url: 'https://cdn.example/image' }],
		['video', { name: 'clip.MP4', url: 'https://cdn.example/video' }],
		['audio', { contentType: 'audio/ogg', url: 'https://cdn.example/audio' }],
		['file', { name: 'report.pdf', url: 'https://cdn.example/file' }]
	])
	value.poll = { question: { text: 'Вопрос?' }, answers: new Map() }
	value.stickers = new Map([['sticker', { id: '1' }]])
	assert.equal(discordNotificationContent(value),
		'Текст https://example.com/page\n[Изображение]\n[Видео]\n[Аудио]\n[Файл]\n[Опрос]\n[Стикер]')
})

test('media embeds hide media URLs and poll-only messages are not empty', () => {
	const value = message('')
	value.embeds = [{ type: 'image', url: 'https://example.com/image.png', image: { url: 'https://example.com/image.png' } },
		{ video: { url: 'https://example.com/video.mp4' } }]
	assert.equal(discordNotificationContent(value), '[Изображение]\n[Видео]')
	value.embeds = []
	value.poll = { question: { text: 'Первый вопрос' }, answers: new Map() }
	const first = prepareMessage(value)
	assert.match(first.parts[0], /\[Опрос\]/)
	assert.ok(!first.parts[0].includes('[Сообщение без текста]'))
	assert.equal(first.hash, prepareMessage(value).hash)
	value.poll.question.text = 'Другой вопрос'
	assert.notEqual(first.hash, prepareMessage(value).hash)
})

test('different images keep different fingerprints despite identical labels', () => {
	const value = message('')
	value.attachments.set('image', { name: 'photo.png', url: 'https://example.com/one.png' })
	const first = prepareMessage(value)
	value.attachments.set('image', { name: 'photo.png', url: 'https://example.com/two.png' })
	const second = prepareMessage(value)
	assert.equal(first.parts[0], second.parts[0])
	assert.notEqual(first.hash, second.hash)
})

test('long messages split without cutting Unicode characters or losing text', () => {
	const result = prepareMessage(message('😀'.repeat(9000)))
	assert.equal(result.parts.length, 3)
	assert.ok(result.parts.every(part => Array.from(part).length <= 4000 && !part.includes('\ufffd')))
	assert.ok(result.parts.join('').includes('😀'.repeat(9000)))
})

test('/start is idempotent, only private chats subscribe, /stop clears pending deliveries', async () => {
	const f = fixture()
	const update = text => ({ message: { chat: { id: 42, type: 'private' }, text } })
	await f.service.handleUpdate(update('/start'))
	await f.service.handleUpdate(update('/start'))
	await f.service.handleUpdate({ message: { chat: { id: -1, type: 'group' }, text: '/start' } })
	assert.equal(f.subscribers.size, 1)
	await f.service.enqueue(message())
	assert.equal(f.jobs.length, 1)
	await f.service.handleUpdate(update('/stop'))
	assert.equal(f.subscribers.get('42'), false)
	assert.equal(f.jobs.length, 0)
	await f.service.handleUpdate(update('/start'))
	assert.equal(f.subscribers.get('42'), true)
})

test('three concurrent duplicates across channels create one delivery per active subscriber', async () => {
	const f = fixture()
	f.subscribers.set('1', true)
	f.subscribers.set('2', true)
	f.subscribers.set('3', false)
	await Promise.all(['a', 'b', 'c'].map(channel => f.service.enqueue(message('Same', channel))))
	assert.equal(f.jobs.length, 2)
	await f.service.deliverOne()
	await f.service.deliverOne()
	assert.deepEqual(f.calls.map(call => call.chat_id), ['1', '2'])
	assert.equal(f.jobs.length, 0)
	assert.ok(f.queries.some(([sql]) => sql.includes("INTERVAL '5 minutes'")))
})

test('blocked subscriber is disabled; other recipients continue', async () => {
	const f = fixture()
	f.subscribers.set('1', true)
	f.subscribers.set('2', true)
	await f.service.enqueue(message())
	f.fail(403)
	await f.service.deliverOne()
	assert.equal(f.subscribers.get('1'), false)
	await f.service.deliverOne()
	assert.equal(f.calls[1].chat_id, '2')
})

test('temporary error keeps the delivery for retry and multipart progress is saved', async () => {
	const f = fixture()
	f.subscribers.set('1', true)
	await f.service.enqueue(message('x'.repeat(5000)))
	f.fail(500)
	await f.service.deliverOne()
	assert.equal(f.jobs[0].attempts, 1)
	assert.equal(f.jobs[0].next_part, 0)
	await f.service.deliverOne()
	assert.equal(f.jobs[0].next_part, 1)
	await f.service.deliverOne()
	assert.equal(f.jobs.length, 0)
})

test('429 retains job and schedules a retry; shutdown interrupts the wait', async () => {
	const f = fixture()
	f.subscribers.set('1', true)
	await f.service.enqueue(message())
	f.fail(429)
	const delivering = f.service.deliverOne()
	// Wait for the request and retry SQL, then abort the backoff.
	await new Promise(resolve => setImmediate(resolve))
	await f.service.stop()
	await assert.rejects(delivering, { name: 'AbortError' })
	assert.equal(f.jobs.length, 1)
	assert.equal(f.jobs[0].attempts, 1)
})

test('polling resumes saved offset, persists subscriptions before offset, and stops cleanly', async () => {
	const f = fixture()
	const offsets = []
	let reachedSecondPoll
	const secondPoll = new Promise(resolve => { reachedSecondPoll = resolve })
	const service = createBroadcastService({ pool: f.pool, token: 'test', request: async (url, options) => {
		if (url.endsWith('/getUpdates')) {
			offsets.push(JSON.parse(options.body).offset)
			if (offsets.length === 1) return { ok: true, json: async () => ({ ok: true, result: [
				{ update_id: 125, message: { chat: { id: 42, type: 'private' }, text: '/start' } }
			] }) }
			reachedSecondPoll()
			return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
		}
		return { ok: true, json: async () => ({ ok: true, result: {} }) }
	} })
	await service.start()
	try {
		await secondPoll
		assert.deepEqual(offsets, [123, 126])
		assert.equal(f.subscribers.get('42'), true)
		const subscriptionIndex = f.queries.findIndex(([sql]) => sql.includes('INSERT INTO telegram_broadcast_subscribers'))
		const offsetIndex = f.queries.findIndex(([sql]) => sql.includes('UPDATE telegram_broadcast_state'))
		assert.ok(subscriptionIndex < offsetIndex)
		assert.equal(f.queries[offsetIndex][1][0], 126)
	} finally {
		await service.stop()
	}
})

test('existing webhook prevents polling without deleting webhook', async () => {
	const f = fixture()
	const methods = []
	const service = createBroadcastService({ pool: f.pool, token: 'test', request: async url => {
		methods.push(url.split('/').pop())
		return { ok: true, json: async () => ({ ok: true, result: { url: 'https://example.com/webhook' } }) }
	} })
	await assert.rejects(service.start(), /активен webhook/)
	assert.deepEqual(methods, ['getWebhookInfo'])
	await service.stop()
})

test('broadcast listener accepts bots from public channels and excludes private and unrelated channels', async () => {
	const savedEnv = { ...process.env }
	const serviceModule = require('../src/services/telegramBroadcastService')
	const originalFactory = serviceModule.createBroadcastService
	const dbPath = require.resolve('../src/services/database')
	const savedDb = require.cache[dbPath]
	const eventPath = require.resolve('../src/events/telegramBroadcast')
	const enqueued = []
	try {
		process.env.DISCORD_NOTIFICATION_CHANNEL_IDS = 'public,private'
		process.env.DISCORD_NOTIFICATION_CHANNEL_ID = 'private'
		process.env.TG_NOTIFICATION_BOT_TOKEN = 'test'
		require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} }
		serviceModule.createBroadcastService = () => ({
			start: async () => {}, stop: async () => {}, enqueue: async value => enqueued.push(value)
		})
		delete require.cache[eventPath]
		const client = new EventEmitter()
		require('../src/events/telegramBroadcast')(client)
		client.emit('clientReady')
		await new Promise(resolve => setImmediate(resolve))
		const [handler] = client.listeners('messageCreate')
		const botMessage = message('Bot', 'public')
		botMessage.author.bot = true
		await handler(botMessage)
		await handler(message('Private', 'private'))
		await handler(message('Other', 'unrelated'))
		assert.deepEqual(enqueued, [botMessage])
		await client.stopTelegramBroadcast()
	} finally {
		serviceModule.createBroadcastService = originalFactory
		if (savedDb) require.cache[dbPath] = savedDb
		else delete require.cache[dbPath]
		delete require.cache[eventPath]
		process.env = savedEnv
	}
})

test('legacy route still sends only private channel to configured chat, with its existing bot filter', async () => {
	const savedEnv = { ...process.env }
	const savedFetch = global.fetch
	try {
		process.env.DISCORD_NOTIFICATION_CHANNEL_ID = 'private'
		process.env.TG_NOTIFICATION_CHAT_ID = 'owner'
		process.env.TG_NOTIFICATION_BOT_TOKEN = 'test'
		const sent = []
		global.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true } }
		const client = new EventEmitter()
		require('../src/events/telegramNotifications')(client)
		const [handler] = client.listeners('messageCreate')
		await handler(message('Public', 'public'))
		await handler(message('Private', 'private'))
		const bot = message('Bot', 'private')
		bot.author.bot = true
		await handler(bot)
		assert.equal(sent.length, 1)
		assert.equal(sent[0].chat_id, 'owner')
		assert.match(sent[0].text, /Private/)
		const poll = message('', 'private')
		poll.poll = { question: { text: 'Вопрос' } }
		await handler(poll)
		assert.match(sent[1].text, /\[Опрос\]/)
		assert.ok(!sent[1].text.includes('[Сообщение без текста]'))
		const image = message('', 'private')
		image.attachments.set('image', { contentType: 'image/png', url: 'https://example.com/picture.png' })
		await handler(image)
		assert.match(sent[2].text, /\[Изображение\]/)
		assert.ok(!sent[2].text.includes('https://example.com/picture.png'))
		assert.ok(sent.every(item => item.chat_id === 'owner'))
	} finally {
		process.env = savedEnv
		global.fetch = savedFetch
	}
})
