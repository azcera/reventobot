const {
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	LabelBuilder
} = require('discord.js')
const { parseDateTime, getDiscordTimestamp } = require('../../utils/dateUtils')
const { sendEphemeralWithAutoDelete } = require('../../utils/autoDelete')
const captureManager = require('./captureManager')
const db = require('../../services/database')
const ADMIN_ROLES = process.env.ADMIN_ROLES
	? process.env.ADMIN_ROLES.split(',')
	: []

/**
 * Показывает модалку ручного создания реги (время, цель, maxMain).
 * @param {ButtonInteraction} interaction
 */
async function showCaptModal(interaction) {
	const modal = new ModalBuilder()
		.setCustomId('modal_capt')
		.setTitle('Создание реги')

	const timeLabel = new LabelBuilder()
		.setLabel('Время проведения')
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('capt_time')
				.setPlaceholder('Например: 18:00 или 29.08.2026 18:00')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
		)
	const targetLabel = new LabelBuilder()
		.setLabel('Цель проведения')
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('capt_target')
				.setPlaceholder('По умолчанию: КАПТ')
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
		)
	const countLabel = new LabelBuilder()
		.setLabel('Количество участников в основе')
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('capt_count')
				.setPlaceholder('По умолчанию: 20')
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
		)

	modal.addLabelComponents(timeLabel, targetLabel, countLabel)
	return await interaction.showModal(modal)
}

/**
 * Валидирует время/цель/кол-во и вызывает captureManager.sendCollection.
 * @param {ModalSubmitInteraction} interaction
 */
async function submitCaptModal(interaction) {
	const timeInput = interaction.fields.getTextInputValue('capt_time').trim()
	const parsedDate = parseDateTime(timeInput)

	if (!parsedDate || isNaN(parsedDate.getTime())) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content:
				'❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.'
		})
	}

	const discordTimestamp = getDiscordTimestamp(parsedDate)
	let target =
		interaction.fields.getTextInputValue('capt_target').trim() || 'капт'
	let maxMain = 20

	const countInput = interaction.fields.getTextInputValue('capt_count').trim()
	if (countInput) {
		const parsedCount = parseInt(countInput, 10)
		if (!isNaN(parsedCount) && parsedCount > 0) {
			maxMain = parsedCount
		} else {
			return await sendEphemeralWithAutoDelete(interaction, {
				content:
					'❌ Количество участников должно быть целым положительным числом.'
			})
		}
	}

	await sendEphemeralWithAutoDelete(interaction, {
		content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}`
	})

	try {
		await captureManager.sendCollection(
			interaction,
			discordTimestamp,
			target,
			maxMain
		)
	} catch (error) {
		console.error('Ошибка при отправке набора:', error)
	}
}

/**
 * Авто-создание капта по кнопке из Telegram-сообщения.
 * Парсит enemy + time из customId, проверяет админ-роль.
 * @param {ButtonInteraction} interaction
 */
async function handleAutoCaptButton(interaction) {
	const hasAdminRole = interaction.member.roles.cache.some(role =>
		ADMIN_ROLES.includes(role.id)
	)

	if (!hasAdminRole) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ У вас нет необходимой роли для использования этой кнопки.'
		})
	}

	// customId формат: capt_Enemy-Faction_DD-MM-YYYY-HH-MM
	const customId = interaction.customId
	const parts = customId.split('_')

	if (parts.length < 3) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ Не удалось распознать данные из кнопки.'
		})
	}

	const enemyRaw = parts[1]
	const timeRaw = parts.slice(2).join('_')

	const target = enemyRaw.replace(/-/g, ' ')
	const timeInput = timeRaw.replace(/-/g, ' ')
	const cleanTimeInput = timeInput.substring(0, 16)

	let parsedDate = null
	if (typeof parseDateTime === 'function') {
		parsedDate = parseDateTime(cleanTimeInput)
	}

	if (!parsedDate || isNaN(parsedDate.getTime())) {
		const dateMatch = cleanTimeInput.match(
			/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/
		)
		if (dateMatch) {
			const [, day, month, year, hours, minutes] = dateMatch
			parsedDate = new Date(
				`${year}-${month}-${day}T${hours}:${minutes}:00+03:00`
			)
		}
	}

	if (!parsedDate || isNaN(parsedDate.getTime())) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: `❌ Не удалось автоматически распознать формат времени: \`${timeInput}\`.`
		})
	}

	const discordTimestamp = getDiscordTimestamp(parsedDate)
	const maxMain = 20

	await sendEphemeralWithAutoDelete(interaction, {
		content: `✅ Капт против **${target}** успешно создан автоматически! Время начала: ${discordTimestamp}`
	})

	try {
		await captureManager.sendCollection(
			interaction,
			discordTimestamp,
			`капт против ${target}`,
			maxMain
		)
	} catch (error) {
		console.error('❌ Ошибка при отправке автоматического набора:', error)
	}
}

/**
 * Показывает модалку изменения времени существующего набора.
 * @param {ButtonInteraction} interaction
 */
async function handleInlineEditTimeButton(interaction) {
	const hasAdminRole = interaction.member.roles.cache.some(role =>
		ADMIN_ROLES.includes(role.id)
	)

	if (!hasAdminRole) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ У вас нет необходимой роли для изменения времени капта.'
		})
	}

	const messageId = interaction.message.id
	const modal = new ModalBuilder()
		.setCustomId(`modal_inline_edit_time_${messageId}`)
		.setTitle('Изменение времени капта')

	const timeLabel = new LabelBuilder()
		.setLabel('Новое время проведения')
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('capt_new_time')
				.setPlaceholder('Например: 18:00 или 29.08.2026 18:00')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
		)

	modal.addLabelComponents(timeLabel)
	return await interaction.showModal(modal)
}

/**
 * Сохраняет новое время в БД и вызывает updateCollectionTime.
 * @param {ModalSubmitInteraction} interaction
 */
async function submitInlineEditTimeModal(interaction) {
	const newTimeInput = interaction.fields
		.getTextInputValue('capt_new_time')
		.trim()
	const parsedDate = parseDateTime(newTimeInput)

	if (!parsedDate || isNaN(parsedDate.getTime())) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content:
				'❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.'
		})
	}

	const newDiscordTimestamp = getDiscordTimestamp(parsedDate)
	const messageId = interaction.customId.replace('modal_inline_edit_time_', '')

	// ✅ Более надежное получение channelId
	const channelId = interaction.channelId || interaction.channel?.id

	if (!channelId) {
		console.error('[EditTime] channelId не найден в interaction')
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ Не удалось определить канал. Попробуйте снова.'
		})
	}

	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

	try {
		// Обновляем время в базе данных
		await db.query(
			'UPDATE active_captures SET discord_timestamp = $1 WHERE message_id = $2',
			[newDiscordTimestamp, messageId]
		)

		// ✅ Передаем client более надежно
		const client = interaction.client
		if (!client) {
			console.error('[EditTime] client не найден в interaction')
			await interaction.editReply({
				content: '❌ Внутренняя ошибка: клиент недоступен.'
			})
			return
		}

		await captureManager.updateCollectionTime(
			messageId,
			channelId,
			newDiscordTimestamp,
			client
		)

		await interaction.editReply({
			content: `✅ Время капта успешно изменено на: ${newDiscordTimestamp}`
		})
	} catch (error) {
		console.error('[EditTime] Ошибка при обновлении времени капта:', error)
		await interaction.editReply({
			content: '❌ Произошла ошибка при обновлении времени.'
		})
	}
}

module.exports = {
	showCaptModal,
	submitCaptModal,
	handleAutoCaptButton,
	handleInlineEditTimeButton,
	submitInlineEditTimeModal
}
