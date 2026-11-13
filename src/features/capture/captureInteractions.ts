import { getError } from '../../utils/errors'
import { store as dashboard } from '../../dashboard/store'
import {
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	PermissionFlagsBits,
	LabelBuilder
} from 'discord.js'
import { parseDateTime, getDiscordTimestamp } from '../../utils/dateUtils'
import { sendEphemeralWithAutoDelete } from '../../utils/autoDelete'
import captureManager = require('./captureManager')
import db = require('../../services/database')
import { collectionCreationError } from './collectionCreation'

/**
 * Показывает модалку ручного создания реги (время, цель, maxMain).
 * @param {ButtonInteraction} interaction
 */
async function showCaptModal(interaction: import('discord.js').ButtonInteraction<'cached'> | import('discord.js').ChatInputCommandInteraction<'cached'>) {
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
				.setPlaceholder('Например: тренировка или мероприятие')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
		)
	const countLabel = new LabelBuilder()
		.setLabel('Лимит подтверждённых участников')
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
async function submitCaptModal(interaction: import('discord.js').ModalSubmitInteraction<'cached'>) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral })
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
		interaction.fields.getTextInputValue('capt_target').trim()
	if (!target) return await sendEphemeralWithAutoDelete(interaction, { content: '❌ Укажите цель регистрации.' })
	let maxMain = 20

	const countInput = interaction.fields.getTextInputValue('capt_count').trim()
	if (countInput) {
		const parsedCount = Number(countInput)
		if (/^\d+$/.test(countInput) && Number.isSafeInteger(parsedCount) && parsedCount > 0) {
			maxMain = parsedCount
		} else {
			return await sendEphemeralWithAutoDelete(interaction, {
				content:
					'❌ Количество участников должно быть целым положительным числом.'
			})
		}
	}

	try {
		const url = await captureManager.sendCollection(
			interaction,
			discordTimestamp,
			target,
			maxMain
		)
		await sendEphemeralWithAutoDelete(interaction, {
			content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}\n${url}`
		})
	} catch (caught) {
 const error = getError(caught);
		console.error('Ошибка при отправке набора:', error)
		await sendEphemeralWithAutoDelete(interaction, { content: collectionCreationError(caught) })
	}
}

/**
 * Авто-создание капта по кнопке из Telegram-сообщения.
 * Парсит enemy + time из customId, проверяет админ-роль или право администратора.
 * @param {ButtonInteraction} interaction
 */
async function handleAutoCaptButton(interaction: import('discord.js').ButtonInteraction<'cached'>) {
	const hasAdminRole = interaction.member.roles.cache.some(role =>
		dashboard.roleIds('ADMIN_ROLES').includes(role.id)
	)

	if (!hasAdminRole && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ У вас нет необходимой роли для использования этой кнопки.'
		})
	}

	const customId = interaction.customId
	const parts = customId.split('_')

	if (parts.length < 3 || (parts[1] === 'tg' && parts.length < 4)) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ Не удалось распознать данные из кнопки.'
		})
	}

	const fromTelegram = parts[1] === 'tg'
	const enemyRaw = parts[fromTelegram ? 2 : 1]
	const timeRaw = parts.slice(fromTelegram ? 3 : 2).join('_')

	const target = fromTelegram ? Buffer.from(enemyRaw.replace(/\./g, '_'), 'base64url').toString('utf8') : enemyRaw.replace(/-/g, ' ')
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

	await interaction.deferReply({ flags: MessageFlags.Ephemeral })

	try {
		await captureManager.sendCollection(
			interaction,
			discordTimestamp,
			`капт против ${target}`,
			maxMain
		)

		await interaction.editReply({
			content: `✅ Капт против **${target}** успешно создан автоматически! Время начала: ${discordTimestamp}`
		})

		setTimeout(async () => {
			try {
				await interaction.deleteReply()
			} catch (e) {}
		}, 5000)
	} catch (caught) {
 const error = getError(caught);
		console.error('❌ Ошибка при отправке автоматического набора:', error)

		await interaction.editReply({
			content:
				collectionCreationError(caught)
		})
	}
}

/**
 * Показывает модалку изменения времени существующего набора.
 * @param {ButtonInteraction} interaction
 */
async function handleInlineEditTimeButton(interaction: import('discord.js').ButtonInteraction<'cached'>) {
	const hasAdminRole = interaction.member.roles.cache.some(role =>
		dashboard.roleIds('ADMIN_ROLES').includes(role.id)
	)

	if (
		!hasAdminRole &&
		!interaction.member.permissions.has(PermissionFlagsBits.Administrator)
	) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ У вас нет необходимой роли для изменения времени регистрации.'
		})
	}

	const messageId = interaction.message.id
	// The modal must be the initial response. Availability is checked atomically
	// by submitInlineEditTimeModal when saving, without a database wait here.
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
async function submitInlineEditTimeModal(interaction: import('discord.js').ModalSubmitInteraction<'cached'>) {
	if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.member.roles.cache.some(role => dashboard.roleIds('ADMIN_ROLES').includes(role.id))) {
		return sendEphemeralWithAutoDelete(interaction, { content: '❌ У вас нет прав для изменения времени регистрации.' })
	}
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

	await interaction.deferReply({ flags: MessageFlags.Ephemeral as const })

	try {
		// Обновляем время в базе данных
		const updated = await db.query(
			`UPDATE active_captures SET discord_timestamp = $1
			 WHERE message_id = $2 AND controls_closed = FALSE
			 AND substring(discord_timestamp from '<t:([0-9]+)')::bigint * 1000 + 3600000 > $3
			 RETURNING message_id`,
			[newDiscordTimestamp, messageId, Date.now()]
		)
		if (!updated.rows.length) return interaction.editReply({ content: '❌ Сбор завершён или больше недоступен.' })

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
	} catch (caught) {
 const error = getError(caught);
		console.error('[EditTime] Ошибка при обновлении времени капта:', error)
		await interaction.editReply({
			content: '❌ Произошла ошибка при обновлении времени.'
		})
	}
}

export {
	showCaptModal,
	submitCaptModal,
	handleAutoCaptButton,
	handleInlineEditTimeButton,
	submitInlineEditTimeModal
}
