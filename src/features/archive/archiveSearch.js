const { Client, ButtonInteraction, MessageFlags } = require('discord.js')
const { followUpEphemeralWithAutoDelete } = require('../../utils/autoDelete')
const { parseDisplayName } = require('../../utils/parseDisplayName')

/**
 * Ищет канал-архив для пользователя, нажавшего кнопку archive_find
 * @param {ButtonInteraction} interaction
 */
async function findArchive(interaction) {
	try {
		await interaction.deferUpdate()
		const member = interaction.member
		const guild = interaction.guild

		const { memberName, memberStatic } = parseDisplayName(member.displayName)

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
				await guild.channels.fetch()
				searchingChannel = guild.channels.cache.find(
					ch => ch.name === searchingChannelName
				)
			} catch (error) {
				console.error('❌ Не удалось загрузить каналы сервера:', error)
			}
		}

		if (searchingChannel) {
			return await interaction.followUp({
				content: `Ваш архив - <#${searchingChannel}>`,
				flags: [MessageFlags.Ephemeral]
			})
		} else {
			return await interaction.followUp({
				content: `❌ Для вас нет созданного архива.`,
				flags: [MessageFlags.Ephemeral]
			})
		}
	} catch (err) {
		console.error('❌ Ошибка: ', err)
	}
}

module.exports = { findArchive }
