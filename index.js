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
const { buildWebContainer } = require('./src/services/containerService')
const loadCommands = require('./src/utils/loadCommands')

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
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'))
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

		const messagePayload = buildWebContainer(req.body)
		await channel.send(messagePayload)

		res.json({ success: true })
	} catch (err) {
		console.error('Ошибка при отправке контейнера с сайта:', err)
		res.status(500).json({ error: err.message })
	}
})

const server = app.listen(3000, () => {
	console.log('🌐 Web server is running on port 3000')
})

// --- GRACEFUL SHUTDOWN (корректное завершение работы) ---
const shutdown = () => {
	console.log('\n🛑 Получен сигнал остановки. Завершаю работу...')
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
	client
		.login(process.env.TOKEN)
		.then(() => console.log('✅ Discord login successful!'))
		.catch(err => console.error('❌ Discord login error:', err))
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
