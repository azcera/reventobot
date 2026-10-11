const { MessageFlags } = require('discord.js')
const { createArchiveChannel } = require('../../utils/channelUtils')
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
 * Парсит userId и имя канала из customId, вызывает createArchiveChannel.
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
		// Сразу подтверждаем interaction
		await interaction
			.deferReply({ flags: [MessageFlags.Ephemeral] })
			.catch(() => {})

		const rawData = customId.replace('create_', '')
		const idMatch = rawData.match(/\d{17,19}$/)
		const targetMemberID = idMatch ? idMatch[0] : null

		if (!targetMemberID) {
			console.error(`❌ Не удалось найти Snowflake в строке: ${rawData}`)
			return await interaction
				.editReply({
					content: '❌ В кнопке не найден ID пользователя.'
				})
				.catch(() => {})
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
			return await interaction
				.editReply({
					content: '❌ Пользователь не найден на сервере.'
				})
				.catch(() => {})
		}

		await interaction.message.delete().catch(() => {})

		return await createArchiveChannel(interaction, {
			channelName: cleanedChannelName,
			member
		})
	}
}

module.exports = { cancelArchive, handleDynamicButtons }
