const {
	Client,
	Collection,
	GatewayIntentBits,
	Partials
} = require('discord.js')
const express = require('express')
const path = require('node:path')
const fs = require('node:fs')
require('dotenv').config()

// Импорты сервисов
const { parseMessageLink, buildEditPayload, registerContainerMessageRoutes } = require('./src/services/containerMessageService')
const loadCommands = require('./src/utils/loadCommands')
const { store: dashboard } = require('./src/dashboard/store')
const { registerDashboard } = require('./src/dashboard/routes')
const pool = require('./src/services/database')
const dashboardReady = dashboard.init(pool).catch(error => {
	console.error('[Dashboard] Не удалось загрузить настройки:', error.code || error.message)
})

// --- ИНИЦИАЛИЗАЦИЯ DISCORD КЛИЕНТА ---
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	],
	partials: [Partials.GuildMember, Partials.User]
})

client.commands = new Collection()

// --- ЗАГРУЗКА КОМАНД (Рекурсивная: ищет все команды в src/commands/) ---
const commandsPath = path.join(__dirname, 'src/commands')
if (fs.existsSync(commandsPath)) {
	loadCommands(client, commandsPath)
} else {
	console.warn('⚠️ Папка с командами не найдена:', commandsPath)
}

// --- ЗАГРУЗКА СОБЫТИЙ (только верхний уровень src/events/) ---
// Файлы в handlers/ не являются событиями, они импортируются внутри самих событий
const eventsPath = path.join(__dirname, 'src/events')
if (fs.existsSync(eventsPath)) {
	const eventFiles = fs
		.readdirSync(eventsPath)
		.filter(file => file.endsWith('.js'))

	for (const file of eventFiles) {
		try {
			const filePath = path.join(eventsPath, file)
			require(filePath)(client)
			console.log(`✅ Загружено событие: ${file}`)
		} catch (error) {
			console.error(`❌ Ошибка загрузки события ${file}:`, error.message)
		}
	}
}

// --- НАСТРОЙКА WEB СЕРВЕРА (Express) ---
const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => {
	res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
		'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" })
	next()
})
app.use(express.json({ limit: '256kb' }))
registerDashboard(app, client, pool)
app.use(express.static(path.join(__dirname, 'public')))
registerContainerMessageRoutes(app, client, {
	beforeMutation: async (req, action, target) => {
		const ids = parseMessageLink(target)
		const dynamic = await pool.query('SELECT 1 FROM active_captures WHERE message_id = $1 LIMIT 1', [ids.messageId])
		if (dynamic.rows.length || ids.channelId === dashboard.getSetting('ARCHIVE_SETTINGS_CHANNEL')) {
			throw Object.assign(new Error('Этот список обновляет бот. Измените его оформление во вкладке «Шаблоны».'), { status: 409 })
		}
		await dashboard.audit(req.dashboardUser.id, action + '.request', target)
	},
	afterMutation: (req, action, target) => dashboard.audit(req.dashboardUser.id, action, target)
		.catch(error => console.error('[Dashboard] Не удалось записать результат изменения:', error.code || error.message))
})

app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// API: информация о канале по ID (для подсказки названия в UI)
app.get('/api/channel-info', async (req, res) => {
	try {
		const channelId = (req.query.id || '').trim()
		if (!channelId || !/^\d{17,20}$/.test(channelId)) {
			return res.status(400).json({ success: false, error: 'Некорректный ID' })
		}

		const channel = await client.channels.fetch(channelId).catch(() => null)
		if (!channel) {
			return res.status(404).json({
				success: false,
				error: 'Канал не найден или нет доступа'
			})
		}

		const name = channel.name || channel.id
		const type = channel.type
		res.json({ success: true, name, type, id: channel.id })
	} catch (err) {
		console.error('Ошибка /api/channel-info:', err)
		res.status(500).json({ success: false, error: err.message })
	}
})

// API endpoint для отправки контейнеров с веб-интерфейса
app.post('/api/send-container', async (req, res) => {
	try {
		const { channelId } = req.body

		if (!channelId) {
			return res.status(400).json({ error: 'Не указан ID канала Discord' })
		}

		const channel = await client.channels.fetch(channelId).catch(() => null)
		if (!channel) {
			return res.status(404).json({
				error: 'Канал не найден или у бота нет к нему прав'
			})
		}

		const messagePayload = buildEditPayload(req.body)
		messagePayload.components[0].toJSON()
		messagePayload.allowedMentions = { parse: dashboard.getSetting('DASHBOARD_ALLOW_MENTIONS') ? ['users', 'roles', 'everyone'] : [] }
		await dashboard.audit(req.dashboardUser.id, 'container.send.request', channelId)
		const sent = await channel.send(messagePayload)
		await dashboard.audit(req.dashboardUser.id, 'container.send', sent.url)
			.catch(error => console.error('[Dashboard] Не удалось записать результат публикации:', error.code || error.message))

		res.json({ success: true })
	} catch (err) {
		console.error('Ошибка при отправке контейнера с сайта:', err)
		res.status(err.status || 500).json({ error: err.message })
	}
})

const port = Number(process.env.PORT || 3000)
const server = app.listen(port, () => {
	console.log(`🌐 Web server is running on port ${port}`)
})

// --- GRACEFUL SHUTDOWN (корректное завершение работы) ---
const shutdown = async () => {
	console.log('\n🛑 Получен сигнал остановки. Завершаю работу...')
	await client.stopTelegramBroadcast?.()
	client.destroy()
	server.close(() => {
		console.log('✅ Сервер остановлен.')
		process.exit(0)
	})
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// --- ЗАПУСК DISCORD КЛИЕНТА ---
// Задержка 5 секунд нужна, чтобы Express успел подняться
setTimeout(() => {
	dashboardReady.then(() => client
		.login(process.env.TOKEN)
		.then(() => console.log('✅ Discord login successful!'))
		.catch(err => console.error('❌ Discord login error:', err)))
}, 5000)

// --- ОБРАБОТКА ОШИБОК ---
client.on('error', error => {
	console.error('Произошла ошибка клиента Discord:', error)
})

process.on('unhandledRejection', error => {
	console.error('Необработанное исключение (Promise Rejection):', error)
})

process.on('uncaughtException', error => {
	console.error('Необработанное исключение (Uncaught Exception):', error)
})
