const { MessageFlags } = require('discord.js')
const { createChannel } = require('../../utils/channelUtils')
const { replyWithAutoDelete } = require('../../utils/autoDelete')

async function cancelArchive(interaction) {
	try {
		await interaction.deferUpdate()
		await interaction.message.delete().catch(() => {})
	} catch (err) {
		console.error('Ошибка удаления:', err)
	}
}

async function handleDynamicButtons(interaction) {
	if (customId.startsWith('cancel_create')) {
		try {
			await interaction.deferUpdate()
			await interaction.message.delete().catch(() => {})
		} catch (err) {
			console.error('❌ Ошибка при отмене создания архива:', err)
		}
		return
	}

	if (interaction.customId.startsWith('create_')) {
		const rawData = interaction.customId.replace('create_', '')

		const idMatch = rawData.match(/\d{17,19}$/)
		const targetMemberID = idMatch ? idMatch[0] : null

		if (!targetMemberID) {
			console.error(`❌ Не удалось найти Snowflake в строке: ${rawData}`)
			return await interaction.reply({
				content: '❌ В кнопке не найден ID пользователя.',
				flags: MessageFlags.Ephemeral
			})
		}

		const rawChannelName = rawData.replace(`-${targetMemberID}`, '')

		const cleanedChannelName = rawChannelName.replace(/-/g, ' ')

		const member = await interaction.guild.members
			.fetch(targetMemberID)
			.catch(err => {
				console.error(
					`❌ Не удалось найти пользователя ${targetMemberID}:`,
					err.message
				)
				return null
			})

		if (!member) {
			return await replyWithAutoDelete(interaction, {
				content: '❌ Пользователь не найден на сервере.'
			})
		}

		await interaction.message.delete().catch(() => {})

		return await createChannel(interaction, {
			channelName: cleanedChannelName,
			member
		})
	}
}

module.exports = { cancelArchive, handleDynamicButtons }
