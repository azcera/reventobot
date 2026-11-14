import { getError } from '../../utils/errors'
import { store as dashboard } from '../../dashboard/store'
import {
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	LabelBuilder
} from 'discord.js'
import { parseDateTime, getMskTimeString } from '../../utils/dateUtils'

import { optionsMap } from '../../features/capture/groupOptions'
import { sendEphemeralWithAutoDelete } from '../../utils/autoDelete'
import { attackEventAt } from '../../services/eventSchedule'
import { collectionCreationError } from './collectionCreation'

/**
 * Показывает модалку (время/цель/код) в зависимости от выбранного значения.
 * @param {Interaction} interaction
 */
async function showGroupModal(interaction: import('discord.js').ButtonInteraction<'cached'> | import('discord.js').ChatInputCommandInteraction<'cached'>, selectedTarget = 'other', attendance = false) {

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
	} else if (attendance) {
		timeLabel.setLabel('Время проверки явки').setDescription('Сбор будет за 5 минут до проверки явки. Время МСК.')
		modal.addLabelComponents(timeLabel, codeLabel)
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
	await interaction.deferReply({ flags: MessageFlags.Ephemeral })
	const selectedValue = interaction.customId.replace('modal_group_', '')
	let timeInput, target, scheduledDate, groupKind: 'supply' | 'attendance' | undefined
	let eventId: string | undefined

	if (selectedValue.startsWith('schedule_')) {
		const event = await scheduledGroupEvent(interaction, selectedValue.slice('schedule_'.length))
		if (!event) return
		scheduledDate = new Date(event.timestamp)
		target = event.label.toUpperCase()
		groupKind = event.groupKind
		eventId = event.id
		if (groupKind === 'attendance') scheduledDate = parseDateTime(interaction.fields.getTextInputValue('group_time').trim()) || undefined
	} else if (selectedValue !== 'other') {
		timeInput = optionsMap[selectedValue].time
		target = optionsMap[selectedValue].target
	} else {
		timeInput = interaction.fields.getTextInputValue('group_time').trim()
		target = interaction.fields.getTextInputValue('group_target')
	}

	const code = interaction.fields.getTextInputValue('group_code').trim().replace(/^groupID:/, '').trim()

	const parsedDate = scheduledDate || parseDateTime(timeInput || '')
	if (groupKind !== 'supply' && (!parsedDate || isNaN(parsedDate.getTime()))) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content:
				'❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.'
		})
	}
	if (groupKind === 'attendance' && (parsedDate!.getTime() <= Date.now() || attackEventAt(parsedDate!.getTime())?.id !== eventId)) {
		return sendEphemeralWithAutoDelete(interaction, { content: '❌ Проверка явки должна быть в будущем, в разрешённое время этого МП: 16:00–19:00 или 20:00–23:00 МСК в соответствующий день.' })
	}

	const mskTimeStr = groupKind === 'supply' ? '' : getMskTimeString(parsedDate!, groupKind === 'attendance' ? -300 : -600)
	const mskTimeWith5MinStr = groupKind === 'supply' ? '' : getMskTimeString(parsedDate!, groupKind === 'attendance' ? 0 : -300)

	try {
		const pingChannelId = dashboard.getSetting('PING_CHANNEL_ID')
		const mentionedRoleId = dashboard.getSetting('AUTO_ROLE')
		if (!pingChannelId)
			return sendEphemeralWithAutoDelete(interaction, { content: '❌ Канал уведомлений о группах не настроен. Группа не опубликована.' })

		const pingChannel =
			interaction.client.channels.cache.get(pingChannelId) ||
			(await interaction.client.channels.fetch(pingChannelId).catch(() => null))

		if (!pingChannel?.isSendable())
			return sendEphemeralWithAutoDelete(interaction, { content: '❌ Канал уведомлений недоступен. Группа не опубликована.' })

		const roleMention = mentionedRoleId ? `<@&${mentionedRoleId}> ` : ''

		const msgContent = dashboard.text('group.message', {
			role: roleMention, target, time: mskTimeStr, attendanceTime: mskTimeWith5MinStr,
			gathering: mskTimeStr ? ` в \`${mskTimeStr}\`` : '',
			attendance: mskTimeWith5MinStr ? `, проверка явки в \`${mskTimeWith5MinStr}\`` : '',
			code: code ? ` 🔑 Код группы: \`${code}\`` : ''
		})

		const url = (await pingChannel.send(msgContent)).url
		let warning = ''
		try {
			for (let i = 0; i < 2; i++) await pingChannel.send(msgContent)
		} catch (error) {
			console.error('Не удалось отправить повторные уведомления о группе:', error)
			warning = '\n⚠️ Не все повторные уведомления отправлены.'
		}
		await sendEphemeralWithAutoDelete(interaction, {
			content: `✅ Группа создана!${mskTimeStr ? `\nВремя: ${mskTimeStr}` : ''}\nЦель: ${target}${code ? `\nКод: ${code}` : ''}\n${url}${warning}`,
			allowedMentions: { parse: [] }
		})
	} catch (caught) {
 const error = getError(caught);
		console.error('❌ Не удалось отправить сообщения в пинг-канал:', error)
		await sendEphemeralWithAutoDelete(interaction, { content: collectionCreationError(caught) })
	}
}

async function scheduledGroupEvent(interaction: import('discord.js').ButtonInteraction<'cached'> | import('discord.js').ModalSubmitInteraction<'cached'>, selection: string) {
	const schedule = interaction.client.eventSchedule
	if (!schedule?.canCreateGroup(interaction.member)) {
		await sendEphemeralWithAutoDelete(interaction, { content: '❌ У вас нет прав для создания группы.' })
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
	const event = await scheduledGroupEvent(interaction, selection)
	if (!event) return
	return showGroupModal(interaction, `schedule_${selection}`, event.groupKind === 'attendance')
}

export { showGroupModal, submitGroupModal, showScheduledGroupModal }
