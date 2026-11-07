const { Events } = require('discord.js')
const { getChannels, createBroadcastService } = require('../services/telegramBroadcastService')
const { store: dashboard } = require('../dashboard/store')

module.exports = client => {
	const token = process.env.TG_NOTIFICATION_BOT_TOKEN
	if (!token) return
	const service = createBroadcastService({ pool: require('../services/database'), token,
		isEnabled: () => dashboard.getSetting('TELEGRAM_BROADCAST_ENABLED') })
	let ready = false
	let starting
	client.stopTelegramBroadcast = async () => {
		ready = false
		await service.stop()
		await starting
	}
	client.once(Events.ClientReady, () => {
		starting = service.start().then(() => {
			ready = true
			console.log('[Telegram broadcast] Рассылка запущена')
		}).catch(error => console.error('[Telegram broadcast] Ошибка запуска:', error.message))
	})
	client.on(Events.MessageCreate, async message => {
		const channels = getChannels({ ...process.env, DISCORD_NOTIFICATION_CHANNEL_IDS: dashboard.getSetting('DISCORD_NOTIFICATION_CHANNEL_IDS') })
		if (!ready || !dashboard.getSetting('TELEGRAM_BROADCAST_ENABLED') || !channels.has(message.channelId) || message.guildId !== process.env.GUILD_ID) return
		try {
			await service.enqueue(message)
		} catch (error) {
			console.error('[Telegram broadcast] Ошибка постановки в очередь:', error.code || 'database error')
		}
	})
}
