const { Events } = require('discord.js')
const { getChannels, createBroadcastService } = require('../services/telegramBroadcastService')

module.exports = client => {
	const channels = getChannels(process.env)
	const token = process.env.TG_NOTIFICATION_BOT_TOKEN
	if (!channels.size || !token) return
	const service = createBroadcastService({ pool: require('../services/database'), token })
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
		if (!ready || !channels.has(message.channelId)) return
		try {
			await service.enqueue(message)
		} catch (error) {
			console.error('[Telegram broadcast] Ошибка постановки в очередь:', error.code || 'database error')
		}
	})
}
