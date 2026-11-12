import { getError, type OperationError } from '../utils/errors'
interface TelegramUpdate { update_id: number; message?: { chat: { id: number; type: string }; text?: string; date?: number } }
interface TelegramResults { sendMessage: unknown; getUpdates: TelegramUpdate[]; getWebhookInfo: { url?: string } }
interface BroadcastError extends OperationError { retryAfter?: number }
function broadcastError(value: unknown): BroadcastError { const error: BroadcastError = getError(value); if (value && typeof value === 'object' && 'retryAfter' in value && typeof value.retryAfter === 'number') error.retryAfter = value.retryAfter; return error }
interface BroadcastOptions { pool: Pg.Pool; token: string; request?: typeof fetch; isEnabled?: () => boolean }
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { discordNotificationContent } from '../utils/discordNotificationContent'
import { createTelegramMajesticSession } from './telegramMajesticSession'

function getChannels(env: T.Env) {
	return new Set((env.DISCORD_NOTIFICATION_CHANNEL_IDS || '').split(',')
		.map(id => id.trim()).filter(id => id && id !== env.DISCORD_NOTIFICATION_CHANNEL_ID?.trim()))
}

function prepareMessage(message: D.Message<true>) {
	const content = discordNotificationContent(message)
	if (!content) return null
	// Keep original media identity: different pictures/polls must not collapse into one label.
	const identity = {
		content,
		attachments: [...message.attachments.values()].map(file => file.url),
		embeds: (message.embeds || []).map(embed => [embed.image?.url, embed.video?.url, embed.url]),
		components: message.components?.map(component => component.toJSON?.() || component),
		poll: message.poll ? [message.poll.question?.text,
			[...(message.poll.answers?.values() || [])].map(answer => [answer.text, answer.emoji?.id, answer.emoji?.name])] : null,
		stickers: [...(message.stickers?.values() || [])].map(sticker => sticker.id)
	}
	const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
	const author = message.member?.displayName || message.author.globalName || message.author.username || message.author.tag
	const text = `📣 Канал: #${('name' in message.channel ? message.channel.name : null) || message.channelId}\n👤 Отправил: ${author}\n\n${content}`
	// Count Unicode code points so a split never breaks a surrogate pair.
	const characters = Array.from(text)
	const parts = []
	for (let i = 0; i < characters.length; i += 4000) {
		parts.push(characters.slice(i, i + 4000).join(''))
	}
	return { hash, parts }
}

function createBroadcastService({ pool, token, request = fetch, isEnabled = () => true }: BroadcastOptions) {
	const controller = new AbortController()
	const { signal } = controller
	let tasks: Promise<void>[] = []
	const pause = (ms: number) => delay(ms, undefined, { signal })

	async function api<K extends keyof TelegramResults>(method: K, body: object): Promise<TelegramResults[K]> {
		const response = await request(`https://api.telegram.org/bot${token}/${method}`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.any([signal, AbortSignal.timeout(40000)])
		})
		const raw: unknown = await response.json()
		if (!raw || typeof raw !== 'object' || !('ok' in raw)) throw new Error('Некорректный ответ Telegram API')
		const data = raw as { ok: boolean; error_code?: number; parameters?: { retry_after?: number }; result: TelegramResults[K] }
		if (!response.ok || !data.ok) {
			const error: BroadcastError = new Error(`Telegram API: ${data.error_code || response.status}`)
			error.code = data.error_code || response.status
			error.retryAfter = data.parameters?.retry_after
			throw error
		}
		return data.result
	}

	async function init() {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS telegram_broadcast_subscribers (
				chat_id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT TRUE
			);
			CREATE TABLE IF NOT EXISTS telegram_broadcast_state (
				id INTEGER PRIMARY KEY CHECK (id = 1), update_offset BIGINT NOT NULL
			);
			INSERT INTO telegram_broadcast_state VALUES (1, 0) ON CONFLICT DO NOTHING;
			CREATE TABLE IF NOT EXISTS telegram_broadcast_dedup (
				hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL
			);
			CREATE TABLE IF NOT EXISTS telegram_broadcast_queue (
				id BIGSERIAL PRIMARY KEY, chat_id TEXT NOT NULL, parts JSONB NOT NULL,
				next_part INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
				retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`)
	}

	async function enqueue(message: D.Message<true>) {
		const prepared = prepareMessage(message)
		if (!prepared) return
		const db = await pool.connect()
		try {
			await db.query('BEGIN')
			await db.query('DELETE FROM telegram_broadcast_dedup WHERE expires_at <= NOW()')
			const claim = await db.query(`INSERT INTO telegram_broadcast_dedup (hash, expires_at)
				VALUES ($1, NOW() + INTERVAL '5 minutes') ON CONFLICT DO NOTHING RETURNING hash`, [prepared.hash])
			if (claim.rows.length) {
				await db.query(`INSERT INTO telegram_broadcast_queue (chat_id, parts)
					SELECT chat_id, $1::jsonb FROM telegram_broadcast_subscribers WHERE active`,
					[JSON.stringify(prepared.parts)])
			}
			await db.query('COMMIT')
		} catch (caught) {
			const error = broadcastError(caught)
			await db.query('ROLLBACK')
			throw error
		} finally {
			db.release()
		}
	}

	async function handleUpdate(update: TelegramUpdate) {
		const message = update.message
		if (message?.chat.type !== 'private') return
		const command = message.text?.trim().split(/\s/)[0].split('@')[0]
		if (await majesticSession.handleMessage(String(message.chat.id), message.text, message.date)) return
		if (command !== '/start' && command !== '/stop') return
		const chatId = String(message.chat.id)
		await pool.query(`INSERT INTO telegram_broadcast_subscribers (chat_id, active) VALUES ($1, $2)
			ON CONFLICT (chat_id) DO UPDATE SET active = EXCLUDED.active`, [chatId, command === '/start'])
		if (command === '/stop') {
			await pool.query('DELETE FROM telegram_broadcast_queue WHERE chat_id = $1', [chatId])
		}
		try {
			await api('sendMessage', { chat_id: chatId, text: command === '/start'
				? 'Вы подписаны на новые сообщения из Discord. Отключить: /stop'
				: 'Рассылка отключена. Подписаться снова: /start' })
		} catch (caught) {
			const error = broadcastError(caught)
			if (signal.aborted) throw error
			console.error('[Telegram broadcast] Ответ на команду:', error.code || 'network error')
		}
	}

	const majesticSession = createTelegramMajesticSession({ pool, send: (chatId, text) => api('sendMessage', { chat_id: chatId, text }).then(() => {}) })

	async function poll() {
		let { rows: [state] } = await pool.query('SELECT update_offset FROM telegram_broadcast_state WHERE id = 1')
		let offset = Number(state.update_offset)
		while (!signal.aborted) {
			try {
				const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] })
				for (const update of updates) {
					await handleUpdate(update)
					await pool.query('UPDATE telegram_broadcast_state SET update_offset = $1 WHERE id = 1', [update.update_id + 1])
					offset = update.update_id + 1
				}
			} catch (caught) {
			const error = broadcastError(caught)
				if (signal.aborted) break
				const safe = (value: unknown) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(value ?? '')) ? String(value) : ''
				console.error('[Telegram broadcast] Получение команд:', {
					name: safe(error?.name), code: safe(error?.code), causeCode: safe(error.cause && typeof error.cause === 'object' && 'code' in error.cause ? error.cause.code : undefined)
				})
				await pause(Math.max(5, error.retryAfter || 0) * 1000)
			}
		}
	}

	async function deliverOne() {
		if (!isEnabled()) return false
		const { rows: [job] } = await pool.query(`SELECT q.* FROM telegram_broadcast_queue q
			JOIN telegram_broadcast_subscribers s ON s.chat_id = q.chat_id AND s.active
			WHERE q.retry_at <= NOW() AND NOT EXISTS (
				SELECT 1 FROM telegram_broadcast_queue earlier WHERE earlier.chat_id = q.chat_id AND earlier.id < q.id
			) ORDER BY q.id LIMIT 1`)
		if (!job) return false
		try {
			await api('sendMessage', { chat_id: job.chat_id, text: job.parts[job.next_part] })
		} catch (caught) {
			const error = broadcastError(caught)
			if (signal.aborted) throw error
			if (error.code === 403) {
				await pool.query('UPDATE telegram_broadcast_subscribers SET active = FALSE WHERE chat_id = $1', [job.chat_id])
				await pool.query('DELETE FROM telegram_broadcast_queue WHERE chat_id = $1', [job.chat_id])
			} else if (error.code === 400 || job.attempts >= 9) {
				console.error('[Telegram broadcast] Задание не доставлено:', job.id, error.code || 'network error')
				await pool.query('DELETE FROM telegram_broadcast_queue WHERE id = $1', [job.id])
			} else {
				const seconds = Math.max(error.retryAfter || 0, Math.min(300, 2 ** (job.attempts + 1)))
				await pool.query(`UPDATE telegram_broadcast_queue SET attempts = attempts + 1,
					retry_at = NOW() + $2 * INTERVAL '1 second' WHERE id = $1`, [job.id, seconds])
				if (error.code === 429) await pause(seconds * 1000)
			}
			return true
		}
		if (job.next_part + 1 === job.parts.length) {
			await pool.query('DELETE FROM telegram_broadcast_queue WHERE id = $1', [job.id])
		} else {
			await pool.query(`UPDATE telegram_broadcast_queue SET next_part = next_part + 1,
				attempts = 0, retry_at = NOW() + INTERVAL '1 second' WHERE id = $1`, [job.id])
		}
		await pool.query(`UPDATE telegram_broadcast_queue SET retry_at = GREATEST(retry_at, NOW() + INTERVAL '1 second')
			WHERE chat_id = $1`, [job.chat_id])
		return true
	}

	async function worker() {
		while (!signal.aborted) {
			try {
				await pause(await deliverOne() ? 100 : 1000)
			} catch (caught) {
			const error = broadcastError(caught)
				if (signal.aborted) break
				console.error('[Telegram broadcast] Очередь:', error.code || 'network/database error')
				await pause(5000)
			}
		}
	}

	return {
		init, enqueue, handleUpdate, deliverOne,
		async start() {
			await init()
			const webhook = await api('getWebhookInfo', {})
			if (webhook.url) throw new Error('У Telegram-бота активен webhook; polling не запущен')
			majesticSession.start()
			tasks = [poll(), worker()].map(task => task.catch(error => {
				if (!signal.aborted) console.error('[Telegram broadcast] Обработчик остановлен:', error.code || 'network/database error')
			}))
		},
		async stop() {
			majesticSession.stop()
			controller.abort()
			await Promise.allSettled(tasks)
		}
	}
}

export { getChannels, prepareMessage, createBroadcastService }
