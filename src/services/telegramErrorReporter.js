const { format } = require('node:util')

function installTelegramErrorReporter({ env = process.env, logger = console, request = (...args) => fetch(...args) } = {}) {
	const token = env.TG_NOTIFICATION_BOT_TOKEN
	const chatId = env.TG_NOTIFICATION_CHAT_ID
	let pending = Promise.resolve()
	if (!token || !chatId) return { flush: () => pending }

	const originalError = logger.error.bind(logger)
	const secrets = Object.entries(env)
		.filter(([key, value]) => value && /TOKEN|SECRET|PASSWORD|API_HASH|SESSION|DATABASE_URL/i.test(key))
		.map(([, value]) => value).sort((a, b) => b.length - a.length)
	logger.error = (...args) => {
		originalError(...args)
		let text = `❌ Ошибка Revento BOT\n${new Date().toISOString()}\n${format(...args)}`
		for (const secret of secrets) text = text.split(secret).join('[скрыто]')
		pending = pending.then(async () => {
			for (let offset = 0; offset < text.length;) {
				let end = Math.min(offset + 4000, text.length)
				if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
				const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
					method: 'POST', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ chat_id: chatId, text: text.slice(offset, end) }),
					signal: AbortSignal.timeout(10000)
				})
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const result = await response.json()
				if (!result.ok) throw new Error(`Telegram API ${result.error_code || 'error'}`)
				offset = end
			}
		}).catch(() => originalError('[Telegram] Не удалось отправить ошибку бота'))
	}
	return { flush: () => pending }
}

module.exports = { installTelegramErrorReporter }
