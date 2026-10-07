const { Guild, ChannelType, MessageFlags } = require('discord.js')
const { getArchivesLists } = require('./archivesList')
const { getUnansweredList } = require('./archiveUnansweredList')
require('dotenv').config()

const adminChannelId = process.env.ARCHIVE_SETTINGS_CHANNEL

/**
 * Отправляет или изменяет сообщение в панель управления
 * Ищет сообщение по уникальному заголовку
 * @param {Guild} guild
 */
async function updateLists(guild) {
	const containers = []
	const allList = await getArchivesLists(guild)
	const unansweredList = await getUnansweredList(guild)
	containers.push(allList?.parts)
	containers.push(unansweredList)

	if (containers.length < 1)
		return console.error('❌Ошибка обновления архивных списков')

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

	const channelMessages = await adminChannel.messages.fetch({ limit: 20 })

	if (channelMessages.size > containers.length) {
		channelMessages.forEach(async (m, index) => {
			if (index + 1 > containers.length) {
				await m.delete()
			}
		})
	}

	containers.forEach(async (c, index) => {
		const data = {
			components: [c],
			flags: [MessageFlags.IsComponentsV2]
		}
		if (channelMessages.size >= index + 1) {
			await channelMessages.at(index).edit(data)
		} else if (channelMessages.size < index + 1) {
			await adminChannel.send(data)
		}
	})
}

module.exports = { updateLists }
