import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js'
import { writeSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { PUBLIC_PATH, ROOT_PATH } from './src/config/path'
import { installTelegramErrorReporter } from './src/services/telegramErrorReporter'
import './src/types'
import { getError } from './src/utils/errors'
import express = require('express')
import path = require('node:path')
import fs = require('node:fs')
require('dotenv').config()
const telegramErrors = installTelegramErrorReporter()

// Импорты сервисов
import { registerDashboard } from './src/dashboard/routes'
import { store as dashboard } from './src/dashboard/store'
import { registerTacticsActivity } from './src/features/tactics/activity'
import {
	buildSendPayload,
	parseMessageLink,
	registerContainerMessageRoutes
} from './src/services/containerMessageService'
import { startRuntimeDiagnostics } from './src/services/runtimeDiagnostics'
import loadCommands = require('./src/utils/loadCommands')
import pool = require('./src/services/database')
const stopRuntimeDiagnostics = startRuntimeDiagnostics(pool)
// --- ИНИЦИАЛИЗАЦИЯ DISCORD КЛИЕНТА ---
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
	],
	partials: [Partials.GuildMember, Partials.User]
})

client.commands = new Collection()

function registerDiscordHandlers() {
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
			const filePath = path.join(eventsPath, file)
			require(filePath)(client)
			console.log(`✅ Загружено событие: ${file}`)
		}
	}
}

// --- НАСТРОЙКА WEB СЕРВЕРА (Express) ---
const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => {
	res.set({
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'same-origin',
		'Content-Security-Policy':
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
	})
	next()
})
let stopping = false
app.get('/readyz', (_req, res) => {
	const ready = !stopping && dashboard.ready && client.isReady()
	res.status(ready ? 200 : 503).json({ ready })
})
app.use((_req, res, next) => {
	if (stopping) {
		res.sendStatus(503)
		return
	}
	next()
})
app.use(express.json({ limit: '256kb', inflate: false }))
const tactics = registerTacticsActivity(app, client, pool)
registerDashboard(app, client, pool)
app.get('/', (req, res) => {
	res.sendFile(path.join(PUBLIC_PATH, 'dashboard', 'index.html'))
})
app.get('/builder.html', (req, res) => res.redirect('/#builder'))
app.use(express.static(path.join(ROOT_PATH, 'dist', 'browser')))
app.use(
	express.static(path.join(PUBLIC_PATH), {
		setHeaders(res, file) {
			if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(file))
				res.setHeader('Cache-Control', 'public, max-age=604800')
		}
	})
)
registerContainerMessageRoutes(app, client, {
	beforeMutation: async (req, action, target) => {
		const ids = parseMessageLink(target)
		const dynamic = await pool.query(
			'SELECT 1 FROM active_captures WHERE message_id = $1 LIMIT 1',
			[ids.messageId]
		)
		const war = await pool.query(
			'SELECT 1 FROM family_wars WHERE announcement_id = $1 OR registration_id = $1 LIMIT 1',
			[ids.messageId]
		)
		if (
			dynamic.rows.length ||
			war.rows.length ||
			ids.channelId === dashboard.getSetting('ARCHIVE_SETTINGS_CHANNEL')
		) {
			throw Object.assign(
				new Error(
					'Этот список обновляет бот. Измените его оформление во вкладке «Шаблоны».'
				),
				{ status: 409 }
			)
		}
		await dashboard.audit(req.dashboardUser, action + '.request', target)
	},
	afterMutation: (req, action, target, details) =>
		dashboard
			.audit(req.dashboardUser, action, target, details)
			.catch(error =>
				console.error(
					'[Dashboard] Не удалось записать результат изменения:',
					error.code || error.message
				)
			)
})

// API: информация о канале по ID (для подсказки названия в UI)
app.get('/api/channel-info', async (req, res) => {
	try {
		const channelId =
			typeof req.query.id === 'string' ? req.query.id.trim() : ''
		if (!channelId || !/^\d{17,20}$/.test(channelId)) {
			return res.status(400).json({ success: false, error: 'Некорректный ID' })
		}

		const channel = await client.channels.fetch(channelId).catch(() => null)
		if (!channel || !channel.isSendable()) {
			return res.status(404).json({
				success: false,
				error: 'Канал не найден или нет доступа'
			})
		}

		const name = ('name' in channel && channel.name) || channel.id
		const type = channel.type
		res.json({ success: true, name, type, id: channel.id })
	} catch (caught) {
		const err = getError(caught)
		console.error('Ошибка /api/channel-info:', err)
		res.status(500).json({ success: false, error: err.message })
	}
})

// API endpoint для отправки контейнеров с веб-интерфейса
app.post('/api/send-container', async (req, res) => {
	try {
		const { channelId } = req.body as { channelId?: string }

		if (!channelId) {
			return res.status(400).json({ error: 'Не указан ID канала Discord' })
		}

		const channel = await client.channels.fetch(channelId).catch(() => null)
		if (!channel?.isSendable()) {
			return res.status(404).json({
				error: 'Канал не найден или у бота нет к нему прав'
			})
		}

		const messagePayload = buildSendPayload(
			req.body,
			dashboard.getSetting('DASHBOARD_ALLOW_MENTIONS')
		)
		await dashboard.audit(
			req.dashboardUser,
			'container.send.request',
			channelId
		)
		const sent = await channel.send(messagePayload)
		await dashboard
			.audit(req.dashboardUser, 'container.send', sent.url)
			.catch(error =>
				console.error(
					'[Dashboard] Не удалось записать результат публикации:',
					error.code || error.message
				)
			)

		res.json({ success: true })
	} catch (caught) {
		const err = getError(caught)
		console.error('Ошибка при отправке контейнера с сайта:', err)
		res.status(err.status || 500).json({ error: err.message })
	}
})

app.get('/{*path}', (req, res, next) => {
	if (req.path.startsWith('/api/') || !req.accepts('html')) return next()
	res.status(404).sendFile(path.join(PUBLIC_PATH, 'dashboard', 'index.html'))
})

const port = Number(process.env.PORT || 3000)
const server = app.listen(port, () => {
	console.log(`🌐 Web server is running on port ${port}`)
})
tactics.attach(server)

async function shutdown(exitCode = 0) {
	if (stopping) return
	stopping = true
	const deadline = setTimeout(() => {
		console.warn('[Shutdown] Превышен срок остановки 15 секунд.')
		process.exit(1)
	}, 15000)
	const closeHttp = new Promise<void>((resolve, reject) =>
		server.close(error =>
			error && getError(error).code !== 'ERR_SERVER_NOT_RUNNING'
				? reject(error)
				: resolve()
		)
	)
	closeHttp.catch(() => {})
	for (const event of [
		'clientReady',
		'messageCreate',
		'interactionCreate',
		'messageDelete',
		'guildMemberRemove',
		'threadCreate',
		'threadDelete'
	]) {
		client.removeAllListeners(event)
	}
	stopRuntimeDiagnostics()
	tactics.stop()
	dashboard.stop()
	const stopSteps = [
		() => client.stopReconciliation?.(),
		() => client.stopTelegramCaptures?.(),
		() => client.stopTelegramNotifications?.(),
		() => client.stopTelegramBroadcast?.(),
		() => client.familyWars?.stop(),
		() => client.captureExpiry?.stop(),
		() => client.captureResults?.stop(),
		() => client.captureRankings?.stop(),
		() => client.majesticNicknames?.stop(),
		() => client.familyMembership?.stop(),
		() => client.eventSchedule?.stop()
	]
	async function close(step: () => unknown) {
		try {
			await step()
		} catch (error) {
			exitCode = 1
			console.warn('[Shutdown]', error)
		}
	}
	await Promise.all([close(() => closeHttp), ...stopSteps.map(close)])
	await Promise.all([close(() => client.destroy()), close(() => pool.end())])
	await close(() => telegramErrors.flush())
	clearTimeout(deadline)
	process.exit(exitCode)
}

process.on('SIGTERM', () => {
	void shutdown()
})
process.on('SIGINT', () => {
	void shutdown()
})

async function start() {
	const token = process.env.TOKEN?.trim()
	if (!token || !process.env.GUILD_ID?.trim())
		throw new Error('Укажите TOKEN и GUILD_ID.')
	for (let attempt = 0; ; attempt++) {
		try {
			await pool.initDb()
			break
		} catch (error) {
			const code = getError(error).code
			if (
				stopping ||
				attempt >= 2 ||
				!['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P03', '08006'].includes(
					String(code)
				)
			)
				throw error
			await delay(500 * 2 ** attempt)
			if (stopping) return
		}
	}
	if (stopping) return
	await dashboard.init(pool)
	if (stopping) {
		dashboard.stop()
		return
	}
	registerDiscordHandlers()
	await client.login(token)
	if (stopping) await client.destroy()
	else console.log('✅ Discord login successful!')
}

client.on('error', error => {
	console.error('Произошла ошибка клиента Discord:', error)
})

process.on('unhandledRejection', error => {
	console.error('Необработанное исключение (Promise Rejection):', error)
	void shutdown(1)
})

process.on('uncaughtException', error => {
	try {
		writeSync(
			process.stderr.fd,
			`[Uncaught exception] ${error.stack || error.message}\n`
		)
	} finally {
		process.exit(1)
	}
})

start().catch(error => {
	console.error('[Startup] Инициализация не завершена:', error)
	void shutdown(1)
})
