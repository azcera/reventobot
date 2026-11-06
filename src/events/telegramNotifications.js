const { Events } = require('discord.js')
const { discordNotificationContent } = require('../utils/discordNotificationContent')
require('dotenv').config()

module.exports = client => {
	const channelId = process.env.DISCORD_NOTIFICATION_CHANNEL_ID
	const token = process.env.TG_NOTIFICATION_BOT_TOKEN
	const chatId = process.env.TG_NOTIFICATION_CHAT_ID
	if (!channelId || !token || !chatId) return

	client.on(Events.MessageCreate, async message => {
		if (message.author.bot || message.channelId !== channelId) return

		const content = discordNotificationContent(message) || '[Сообщение без текста]'
		const text = `🔔 Уведомление\nОт: ${message.author.tag}\n${content}`

		try {
			const response = await fetch(
				`https://api.telegram.org/bot${token}/sendMessage`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) })
				}
			)
			if (!response.ok)
				console.error(
					'[Telegram] Ошибка отправки уведомления:',
					response.status
				)
		} catch (error) {
			console.error('[Telegram] Ошибка отправки уведомления:', error.message)
		}
	})
}
