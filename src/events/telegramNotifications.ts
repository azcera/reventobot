import { Events } from 'discord.js'
import { randomUUID } from 'node:crypto'
import { discordNotificationContent } from '../utils/discordNotificationContent'
import pool = require('../services/database')
require('dotenv').config()

export = (client: import('discord.js').Client) => {
	const channelId = process.env.DISCORD_NOTIFICATION_CHANNEL_ID
	const token = process.env.TG_NOTIFICATION_BOT_TOKEN
	const chatId = process.env.TG_NOTIFICATION_CHAT_ID
	if (!channelId || !token || !chatId) return

	const controller = new AbortController()
	let timer: NodeJS.Timeout | undefined
	let active: Promise<void> | undefined

	async function deliver() {
		const lease = randomUUID()
		const {
			rows: [job]
		} = await pool.query<{
			message_id: string
			chat_id: string
			text: string
			attempts: number
		}>(
			`WITH ready AS (
			SELECT message_id FROM telegram_notification_queue
			WHERE completed_at IS NULL AND retry_at <= NOW() AND (lease_until IS NULL OR lease_until <= NOW())
			ORDER BY retry_at, message_id LIMIT 1 FOR UPDATE SKIP LOCKED
		)
		UPDATE telegram_notification_queue q SET lease_token = $1, lease_until = NOW() + INTERVAL '1 minute'
		FROM ready WHERE q.message_id = ready.message_id RETURNING q.*`,
			[lease]
		)
		if (!job || controller.signal.aborted) return
		let status = 0,
			retryAfter = 0,
			sent = false
		try {
			const response = await fetch(
				`https://api.telegram.org/bot${token}/sendMessage`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ chat_id: job.chat_id, text: job.text }),
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(10000)
					])
				}
			)
			status = response.status
			const data = await response.json()
			sent = response.ok && data.ok === true
			retryAfter =
				Number(
					data.parameters?.retry_after ?? response.headers.get('retry-after')
				) || 0
		} catch {}
		if (controller.signal.aborted) return
		const failed =
			!sent &&
			(job.attempts >= 9 || (status >= 400 && status < 500 && status !== 429))
		const retry = Math.max(retryAfter, Math.min(300, 2 ** (job.attempts + 1)))
		await pool.query(
			`UPDATE telegram_notification_queue SET attempts = attempts + 1, lease_token = NULL, lease_until = NULL,
			retry_at = NOW() + $3 * INTERVAL '1 second', completed_at = CASE WHEN $4 THEN NOW() ELSE NULL END, failed = $5
			WHERE message_id = $1 AND lease_token = $2`,
			[job.message_id, lease, retry, sent || failed, failed]
		)
		if (failed)
			console.error(
				'[Telegram] Уведомление не доставлено:',
				job.message_id,
				status
			)
	}

	function tick() {
		if (!controller.signal.aborted)
			active ??= deliver()
				.catch(error => console.error('[Telegram notification queue]', error))
				.finally(() => {
					active = undefined
				})
	}
	client.once(Events.ClientReady, () => {
		timer = setInterval(tick, 1000)
		timer.unref()
		tick()
	})
	client.stopTelegramNotifications = async () => {
		clearInterval(timer)
		controller.abort()
		await active
	}
	client.on(Events.MessageCreate, async message => {
		if (
			message.author.bot ||
			message.channelId !== channelId ||
			controller.signal.aborted
		)
			return
		const content =
			discordNotificationContent(message) || '[Сообщение без текста]'
		const text = Array.from(
			`🔔 Уведомление\nОт: ${message.author.tag}\n${content}`
		)
			.slice(0, 4000)
			.join('')
		try {
			await pool.query(
				`INSERT INTO telegram_notification_queue (message_id, chat_id, text)
				VALUES ($1, $2, $3) ON CONFLICT (message_id) DO NOTHING`,
				[message.id, chatId, text]
			)
			tick()
		} catch (error) {
			console.error('[Telegram] Не удалось сохранить уведомление:', error)
		}
	})
}
