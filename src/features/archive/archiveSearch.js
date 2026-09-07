const { Client, ButtonInteraction, MessageFlags } = require('discord.js')

/**
 * Ищет канал-архив для пользователя, нажавшего кнопку archive_find
 * @param {ButtonInteraction} interaction
 */
async function findArchive(interaction) {
	try {
		await interaction.deferUpdate()
		const member = interaction.member

		const [memberName, memberStatic] = member.displayName.split('|')

		memberStatic.trim()
		memberName.replace(/^\[.*\]/, '').trim()

		const searchingChannelName = `archive ${memberName.toLowerCase()} ${memberStatic.toLowerCase()}`
		const searchingChannel = interaction.guild.channels.cache.find(
			ch => ch.name === searchingChannel
		)

		if (!searchingChannel) {
			return await interaction.channel.send({
				content: `❌ Для вас нет созданного архива. Название канала: \`${searchingChannelName}\``,
				flags: [MessageFlags.Ephemeral]
			})
		}
	} catch (err) {
		console.error('❌ Ошибка: ', err)
	}
}

module.exports = { findArchive }
