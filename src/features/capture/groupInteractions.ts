import { getError } from '../../utils/errors'
import { store as dashboard } from '../../dashboard/store'
import {
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	LabelBuilder
} from 'discord.js'
import { parseDateTime, getMskTimeString } from '../../utils/dateUtils'

import { optionsMap } from '../../features/capture/groupOptions'
import { sendEphemeralWithAutoDelete } from '../../utils/autoDelete'

/**
 * Показывает модалку (время/цель/код) в зависимости от выбранного значения.
 * @param {Interaction} interaction
 */
async function showGroupModal(interaction: import('discord.js').ButtonInteraction<'cached'> | import('discord.js').ChatInputCommandInteraction<'cached'>, selectedTarget = 'other') {

	const modal = new ModalBuilder()
		.setCustomId(`modal_group_${selectedTarget}`)
		.setTitle('Создание группы')

	const timeLabel = new LabelBuilder()
		.setLabel('Время проведения')
		.setDescription(
			'Указывать именно начало МП, время группа и проверки явки рассчитается само'
		)
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('group_time')
				.setPlaceholder('Например: 18:00 или 29.08.2026 18:00 ')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
		)
	const targetLabel = new LabelBuilder()
		.setLabel('Цель')
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('group_target')
				.setPlaceholder('Например: ОСТРОВ, ОГРАБЛЕНИЯ, КОНТРАКТЫ')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
		)
	const codeLabel = new LabelBuilder()
		.setLabel('Код группы')
		.setTextInputComponent(
			new TextInputBuilder()
				.setCustomId('group_code')
				.setPlaceholder('Можно оставить пустым')
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
		)

	if (selectedTarget === 'other') {
		modal.addLabelComponents(timeLabel, targetLabel, codeLabel)
	} else {
		modal.addLabelComponents(codeLabel)
	}

	return await interaction.showModal(modal)
}

/**
 * Валидирует время, считает МСК-время −10 и −5 мин, пингует роль 3 раза.
 * @param {ModalSubmitInteraction} interaction
 */
async function submitGroupModal(interaction: import('discord.js').ModalSubmitInteraction<'cached'>) {
	const selectedValue = interaction.customId.replace('modal_group_', '')
	let timeInput, target, scheduledDate

	if (selectedValue.startsWith('schedule_')) {
		const event = await scheduledGroupEvent(interaction, selectedValue.slice('schedule_'.length))
		if (!event) return
		scheduledDate = new Date(event.timestamp)
		target = event.label.toUpperCase()
	} else if (selectedValue !== 'other') {
		timeInput = optionsMap[selectedValue].time
		target = optionsMap[selectedValue].target
	} else {
		timeInput = interaction.fields.getTextInputValue('group_time').trim()
		target = interaction.fields.getTextInputValue('group_target')
	}

	const code = interaction.fields.getTextInputValue('group_code').trim()

	const parsedDate = scheduledDate || parseDateTime(timeInput || '')
	if (!parsedDate || isNaN(parsedDate.getTime())) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content:
				'❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.'
		})
	}

	const mskTimeStr = getMskTimeString(parsedDate, -600)
	const mskTimeWith5MinStr = getMskTimeString(parsedDate, -300)

	await sendEphemeralWithAutoDelete(interaction, {
		content: `✅ Группа создана!\nВремя: ${mskTimeStr}\nЦель: ${target}${code ? `\nКод: ${code}` : ''}`
	})

	try {
		const pingChannelId = process.env.PING_CHANNEL_ID
		const mentionedRoleId = dashboard.getSetting('AUTO_ROLE')
		if (!pingChannelId)
			return console.log('❌ В файле .env не указан PING_CHANNEL_ID')

		const pingChannel =
			interaction.client.channels.cache.get(pingChannelId) ||
			(await interaction.client.channels.fetch(pingChannelId).catch(() => null))

		if (!pingChannel?.isSendable())
			return console.log(`❌ Канал с ID ${pingChannelId} не найден.`)

		const roleMention = mentionedRoleId ? `<@&${mentionedRoleId}> ` : ''

		const msgContent = `# 📢 ${roleMention} Групп на \`${target}\` в \`${mskTimeStr}\`, проверка явки в \`${mskTimeWith5MinStr}\`.${code ? ` 🔑 Код группы: \`${code}\`` : ''}`

		for (let i = 0; i < 3; i++) {
			await pingChannel.send(msgContent)
		}
	} catch (caught) {
 const error = getError(caught);
		console.error('❌ Не удалось отправить сообщения в пинг-канал:', error)
	}
}

async function scheduledGroupEvent(interaction: import('discord.js').ButtonInteraction<'cached'> | import('discord.js').ModalSubmitInteraction<'cached'>, selection: string) {
	const schedule = interaction.client.eventSchedule
	if (!schedule?.canCreateGroup(interaction.member)) {
		await sendEphemeralWithAutoDelete(interaction, { content: '❌ Создавать групп могут только администраторы и роли ADMIN_ROLES.' })
		return null
	}
	const event = schedule.resolveSelection(selection)
	if (!event) {
		await sendEphemeralWithAutoDelete(interaction, { content: '❌ Событие уже началось или расписание изменилось/недоступно. Используйте обновлённое сообщение.' })
		return null
	}
	return event
}

async function showScheduledGroupModal(interaction: import('discord.js').ButtonInteraction<'cached'>) {
	const selection = interaction.customId.slice('schedule_group_'.length)
	if (!await scheduledGroupEvent(interaction, selection)) return
	return showGroupModal(interaction, `schedule_${selection}`)
}

export { showGroupModal, submitGroupModal, showScheduledGroupModal }
