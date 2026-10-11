const { Client, ButtonInteraction, MessageFlags } = require('discord.js')
const { parseDisplayName } = require('../../utils/parseDisplayName')

/**
 * Ищет канал-архив для пользователя, нажавшего кнопку archive_find
 * @param {ButtonInteraction} interaction
 */
async function findArchive(interaction) {
	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

	try {
		const member = interaction.member
		const guild = interaction.guild

		const parsed = parseDisplayName(member.displayName)

		if (!parsed) {
			return await interaction.editReply({
				content: `❌ Не удалось найти архив: ваш никнейм на сервере имеет неверный формат.`
			})
		}

		const { memberName, memberStatic } = parsed

		const searchingChannelName = [
			'archive',
			memberName.toLowerCase(),
			memberStatic
		].join(' ')

		let searchingChannel = guild.channels.cache.find(
			ch => ch.name === searchingChannelName
		)

		if (!searchingChannel) {
			try {
				const fetchedChannels = await guild.channels.fetch()
				searchingChannel = fetchedChannels.find(
					ch => ch.name === searchingChannelName
				)
			} catch (error) {
				console.error('❌ Не удалось загрузить каналы сервера:', error)
			}
		}

		if (searchingChannel) {
			return await interaction.editReply({
				content: `Ваш архив - <#${searchingChannel.id}>`
			})
		} else {
			return await interaction.editReply({
				content: `❌ Для вас нет созданного архива.`
			})
		}
	} catch (err) {
		console.error('❌ Ошибка при поиске архива: ', err)
		try {
			await interaction.editReply({
				content: '❌ Произошла внутренняя ошибка при поиске архива.'
			})
		} catch (_) {}
	}
}

module.exports = { findArchive }
