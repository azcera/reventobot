const { MessageFlags } = require('discord.js')
const { createChannel } = require('../../utils/channelUtils')
const { replyWithAutoDelete } = require('../../utils/autoDelete')

/**
 * Обрабатывает кнопку «Нет» (cancel) — просто удаляет сообщение.
 * @param {ButtonInteraction} interaction
 */
async function cancelArchive(interaction) {
	try {
		await interaction.deferUpdate()
		await interaction.message.delete().catch(() => {})
	} catch (err) {
		console.error('Ошибка удаления:', err)
	}
}

/**
 * Обрабатывает кнопки create_ / cancel_create_ для создания архив-канала.
 * Парсит userId и имя канала из customId, вызывает createChannel.
 * @param {ButtonInteraction} interaction
 */
async function handleDynamicButtons(interaction) {
	const customId = interaction.customId
	if (customId.startsWith('cancel_create')) {
		try {
			await interaction.deferUpdate()
			await interaction.message.delete().catch(() => {})
		} catch (err) {
			console.error('❌ Ошибка при отмене создания архива:', err)
		}
		return
	}

	if (customId.startsWith('create_')) {
		const rawData = customId.replace('create_', '')

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
