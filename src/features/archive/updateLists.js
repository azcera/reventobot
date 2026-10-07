const {
	Guild,
	ChannelType,
	MessageFlags,
	ContainerBuilder
} = require('discord.js')
const { getArchivesLists } = require('./archivesList')
const { getUnansweredList } = require('./archiveUnansweredList')
require('dotenv').config()

const adminChannelId = process.env.ARCHIVE_SETTINGS_CHANNEL

/**
 * Отправляет или изменяет сообщение в панель управления
 * @param {Guild} guild
 */
async function updateLists(guild) {
	/**
	 * @type {ContainerBuilder[]}
	 */
	const containers = []
	const allList = await getArchivesLists(guild)
	const unansweredList = await getUnansweredList(guild)

	if (allList && Array.isArray(allList.parts)) {
		containers.push(...allList.parts)
	}

	if (unansweredList) {
		containers.push(unansweredList)
	}

	if (containers.length < 1)
		return console.error('❌ Ошибка обновления архивных списков: списки пусты')

	const adminChannel =
		guild.channels.cache.get(adminChannelId) ||
		(await guild.channels.fetch(adminChannelId))

	if (
		!adminChannel ||
		(adminChannel && adminChannel.type != ChannelType.GuildText)
	) {
		return console.error(
			'❌ Канал архивных списков не настроен или отсутствует'
		)
	}

	const channelMessagesCollection = await adminChannel.messages.fetch({
		limit: 20
	})
	const channelMessages = Array.from(
		channelMessagesCollection.values()
	).reverse()

	if (channelMessages.length > containers.length) {
		for (let i = containers.length; i < channelMessages.length; i++) {
			await channelMessages[i].delete().catch(console.error)
		}
	}

	for (let index = 0; index < containers.length; index++) {
		const c = containers[index]

		const data = {
			components: [c],
			flags: [MessageFlags.IsComponentsV2]
		}

		try {
			if (channelMessages.length >= index + 1) {
				await channelMessages[index].edit(data)
			} else {
				await adminChannel.send(data)
			}
		} catch (error) {
			console.error(
				`❌ Ошибка обновления/отправки сообщения на индексе ${index}:`,
				error
			)
		}
	}
}

module.exports = { updateLists }
