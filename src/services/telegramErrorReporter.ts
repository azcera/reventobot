import { setTimeout as delay } from 'node:timers/promises'
import { formatWithOptions } from 'node:util'
import type * as T from '../types'

const CONNECTION_ALERT_INTERVAL = 15 * 60000
const NETWORK_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT']

function connectionAlert(context: string, error: {
	name?: string
	message?: string
	code?: string | number
	cause?: { code?: string }
	causeCode?: string
	connectionTimeout?: boolean
	connectionTerminated?: boolean
}) {
	if (
		error.code === '08006' ||
		error.connectionTimeout ||
		error.connectionTerminated ||
		/^(Connection terminated (?:due to connection timeout|unexpectedly)|timeout exceeded when trying to connect|\(EAUTHTIMEOUT\) timeout while waiting for message)$/.test(error.message || '')
	)
		return 'PostgreSQL'
	if (
		error.name === 'TimeoutError' ||
		NETWORK_CODES.includes(String(error.causeCode || error.cause?.code || error.code))
	) {
		if (context.startsWith('[Telegram broadcast]')) return 'Telegram broadcast'
		if (context === '[CaptureResults]') return 'CaptureResults'
	}
}

function installTelegramErrorReporter({
	env = process.env,
	logger = console,
	request = fetch
}: {
	env?: T.Env
	logger?: Pick<Console, 'error'>
	request?: typeof fetch
} = {}) {
	const token = env.TG_NOTIFICATION_BOT_TOKEN
	const chatId = env.TG_NOTIFICATION_CHAT_ID
	const originalError = logger.error.bind(logger)
	let running: Promise<void> | undefined
	if (!token || !chatId) return { flush: async () => {} }

	const secrets = Object.entries(env)
		.filter(
			([key, value]) =>
				value &&
				/TOKEN|SECRET|PASSWORD|API_HASH|API_KEY|SESSION|DATABASE_URL|SUPABASE_URL/i.test(
					key
				)
		)
		.flatMap(([key, value]) => {
			if (!/DATABASE_URL|SUPABASE_URL/i.test(key)) return [value!]
			try {
				return [value!, decodeURIComponent(new URL(value!).password)].filter(
					Boolean
				)
			} catch {
				return [value!]
			}
		})
		.sort((a, b) => b.length - a.length)
	const pending = new Map<string, number>()
	const connectionAlerts = new Map<string, { next: number; skipped: number }>()
	let discarded = 0

	async function deliver(text: string) {
		for (let attempt = 0; attempt < 3; attempt++) {
			const response = await request(
				`https://api.telegram.org/bot${token}/sendMessage`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ chat_id: chatId, text }),
					signal: AbortSignal.timeout(5000)
				}
			)
			const result = await response.json().catch(() => ({}))
			if (response.ok && result.ok) return
			if (attempt === 2 || (response.status !== 429 && response.status < 500))
				throw new Error('Telegram delivery failed')
			const retry = Number(
				result.parameters?.retry_after ?? response.headers.get('retry-after')
			)
			await delay(
				Math.min(10000, retry > 0 ? retry * 1000 : 500 * 2 ** attempt)
			)
		}
	}

	async function drain() {
		while (pending.size) {
			const [message, count] = pending.entries().next().value!
			pending.delete(message)
			const omitted = discarded
			discarded = 0
			const suffix =
				(count > 1 ? `\nПовторов: ${count}.` : '') +
				(omitted ? `\nПропущено из-за лимита очереди: ${omitted}.` : '')
			await deliver(
				`❌ Ошибка Revento BOT\n${new Date().toISOString()}\n${message}${suffix}`
			).catch(() =>
				originalError('[Telegram] Не удалось отправить ошибку бота')
			)
		}
	}
	logger.error = (...args) => {
		originalError(...args)
		const context = typeof args[0] === 'string' ? args[0] : ''
		const details = args.find(arg => arg && typeof arg === 'object')
		if (details?.code === 10062 || details?.code === 40060) return
		const group =
			details && !/^(\[Startup\]|Необработанное исключение)/.test(context)
				? connectionAlert(context, details)
				: undefined
		const timestamp = Date.now()
		const previous = group ? connectionAlerts.get(group) : undefined
		if (previous && timestamp < previous.next) {
			previous.skipped++
			return
		}
		let message = formatWithOptions(
			{ depth: 3, maxStringLength: 8000, maxArrayLength: 20 },
			...args
		)
		for (const secret of secrets)
			message = message.split(secret).join('[скрыто]')
		message = message.replace(/(\/(?:interactions|webhooks)\/\d+\/)[^/\s?'"]+/g, '$1[скрыто]')
		message = message.slice(0, 3800).replace(/[\uD800-\uDBFF]$/, '')
		if (pending.has(message)) pending.set(message, pending.get(message)! + 1)
		else if (pending.size >= 32) {
			discarded++
			return
		} else pending.set(message, 1 + (previous?.skipped ?? 0))
		if (group)
			connectionAlerts.set(group, {
				next: timestamp + CONNECTION_ALERT_INTERVAL,
				skipped: 0
			})
		if (!running)
			running = Promise.resolve()
				.then(drain)
				.finally(() => {
					running = undefined
				})
	}
	return {
		async flush() {
			await running
		}
	}
}

export { installTelegramErrorReporter }
