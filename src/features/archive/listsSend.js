const {
	Guild,
	ChannelType,
	ContainerBuilder,
	MessageFlags
} = require('discord.js')

const adminChannelId = '1543180993786150992'

/**
 * Отправляет или изменяет сообщение в панель управления
 * Ищет сообщение по уникальному заголовку
 *
 * @param {Guild} guild
 * @param {string} uniqueTitle - уникальный текст для поиска (например "# 🙊 Список неотвеченных архивов")
 * @param {ContainerBuilder} container
 */
async function listsSend(guild, uniqueTitle, container) {
	const adminChannel =
		guild.channels.cache.get(adminChannelId) ||
		(await guild.channels.fetch(adminChannelId))

	if (!adminChannel || adminChannel.type !== ChannelType.GuildText) {
		return console.error('❌ Неправильно настроен канал с панелью управления.')
	}

	const messages = await adminChannel.messages.fetch({ limit: 20 })

	// Ищем сообщение, в котором уже есть наш уникальный заголовок
	const existingMessage = messages.find(msg => {
		if (!msg.components?.length) return false

		// Ищем TextDisplay с нужным заголовком
		return msg.components.some(row => {
			return (
				row.components?.some(comp => {
					return comp.data?.content?.includes(uniqueTitle)
				}) || row.data?.content?.includes(uniqueTitle)
			)
		})
	})

	const messageData = {
		components: [container],
		flags: [MessageFlags.IsComponentsV2]
	}

	if (existingMessage) {
		await existingMessage.edit(messageData)
	} else {
		await adminChannel.send(messageData)
	}
}

module.exports = { listsSend }
