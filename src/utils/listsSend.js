const {
	Guild,
	ChannelType,
	ContainerBuilder,
	Component,
	ContainerComponent
} = require('discord.js')

const adminChannelId = '1543180993786150992'

/**
 * Отправляет или изменяет сообщение в панель управления
 *
 * @param {Guild} guild
 * @param {ContainerBuilder} container
 * @param {number} messageIndex
 */
async function listsSend(guild, messageIndex, container) {
	const adminChannel =
		guild.channels.cache.get(adminChannelId) ||
		(await guild.channels.fetch(adminChannelId))

	if (!adminChannel || adminChannel?.type != ChannelType.GuildText) {
		return console.error('❌ Неправильно настроен канал с панелью управления.')
	}

	const messagesList = await adminChannel.messages.fetch()

	const messageData = {
		components: [container],
		flags: [MessageFlags.IsComponentsV2]
	}

	if (messagesList.size >= messageIndex + 1) {
		await messagesList.at(messageIndex)?.edit(messageData)
	} else {
		await adminChannel.send(messageData)
	}
}

module.exports = { listsSend }
