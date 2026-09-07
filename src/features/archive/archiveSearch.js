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
		memberName.replace(/^\[.*\]\s+/g, '').trim()
		const guild = interaction.guild

		const searchingChannelName = `archive ${memberName.toLowerCase()} ${memberStatic.toLowerCase()}`
		let searchingChannel = guild.channels.cache.find(
			ch => ch.name === searchingChannelName
		)

		if (!searchingChannel) {
			try {
				await guild.channels.fetch()
				searchingChannel = guild.channels.cache.find(
					ch => ch.name === searchingChannel
				)
			} catch (error) {
				console.error('Не удалось загрузить каналы сервера:', error)
			}
		}

		if (searchingChannel) {
			console.log(`Канал найден! Его ID: ${searchingChannel.id}`)
		} else {
			return await interaction.followUp({
				content: `❌ Для вас нет созданного архива. Название канала: \`${searchingChannelName}\``,
				flags: [MessageFlags.Ephemeral]
			})
		}
	} catch (err) {
		console.error('❌ Ошибка: ', err)
	}
}

module.exports = { findArchive }
