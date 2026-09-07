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

		let parsed
		try {
			parsed = parseDisplayName(member.displayName)
		} catch (parseError) {
			return await interaction.followUp({
				content: `❌ Не удалось найти архив: ваш никнейм на сервере имеет неверный формат.`,
				flags: [MessageFlags.Ephemeral]
			})
		}

		const { memberName, memberStatic } = parsed

		// 3. Формируем имя канала (теперь без ошибок undefined)
		const searchingChannelName = [
			'archive',
			memberName.toLowerCase(),
			memberStatic.toLowerCase()
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
			return await interaction.followUp({
				content: `Ваш архив - <#${searchingChannel.id}>`,
				flags: [MessageFlags.Ephemeral]
			})
		} else {
			return await interaction.followUp({
				content: `❌ Для вас нет созданного архива.`,
				flags: [MessageFlags.Ephemeral]
			})
		}
	} catch (err) {
		console.error('❌ Ошибка при поиске архива: ', err)

		try {
			await interaction.followUp({
				content: '❌ Произошла внутренняя ошибка при поиске архива.',
				flags: [MessageFlags.Ephemeral]
			})
		} catch (_) {}
	}
}

module.exports = { findArchive }
