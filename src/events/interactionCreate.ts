import { getError } from '../utils/errors'
import { MessageFlags } from 'discord.js'
import { store as dashboard } from '../dashboard/store'
import { authorize, MOVED_BUTTON_IDS } from '../services/adminApplicationCommands'
import captureManager = require('../features/capture/captureManager')
import groupInteractions = require('../features/capture/groupInteractions')
import captureInteractions = require('../features/capture/captureInteractions')
import archiveInteractions = require('../features/archive/archiveInteractions')
import moveAllInteractions = require('../features/moveAll/moveAllInteractions')
import inviteApplication = require('../features/invite/inviteApplication')
import {
	handleModerationButton
} from '../features/invite/inviteModeration'
import { handleVoiceSelect } from '../features/invite/inviteVoiceSelect'
import submitRejectModal = require('../features/invite/inviteModalHandler')
import { findArchive } from '../features/archive/archiveSearch'
import {
	followUpEphemeralWithAutoDelete,
	replyWithAutoDelete
} from '../utils/autoDelete'

export = (client: import('discord.js').Client) => {
	client.on('interactionCreate', async interaction => {
        if (!interaction.isRepliable()) return
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: 'Действие доступно только на сервере. Повторите после восстановления подключения.', flags: MessageFlags.Ephemeral }).catch(console.error)
            return
        }
        const startedAt = performance.now()
        try {
		if (interaction.isChatInputCommand() || interaction.isUserContextMenuCommand()) {
			const command = client.commands.get(interaction.commandName)
			if (!command || !('data' in command)) return interaction.reply({ content: 'Команда больше недоступна.', flags: MessageFlags.Ephemeral })
			try {
				await command.execute(interaction)
			} catch (caught) {
 const error = getError(caught);
				console.error(error)
				if (error?.code === 10062) return
				if (!interaction.replied && !interaction.deferred && Date.now() - interaction.createdTimestamp >= 3000) return
				const payload = {
					content: '❌ Произошла ошибка при запуске команды!',
					flags: MessageFlags.Ephemeral as const
				}
				if (interaction.replied || interaction.deferred) {
					await followUpEphemeralWithAutoDelete(interaction, payload)
				} else {
					await replyWithAutoDelete(interaction, payload)
				}
			}
			return
		}

		if (interaction.isButton() && (interaction.customId.startsWith('capt_api_') || interaction.customId.startsWith('war_'))) {
			if (!client.familyWars) return interaction.reply({ content: 'API-регистрация каптов временно отключена.', flags: MessageFlags.Ephemeral })
			return await client.familyWars.handle(interaction)
		}

		if (('customId' in interaction && interaction.customId.startsWith('mcl_')) && (interaction.isButton() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu())) {
			if (!client.mclLists) return interaction.reply({ content: 'Списки временно недоступны.', flags: MessageFlags.Ephemeral })
			return await client.mclLists.handle(interaction)
		}

		if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('family_cleanup_')) {
			if (!client.familyMembership) return interaction.reply({ content: 'Проверка семьи ещё не готова.', flags: MessageFlags.Ephemeral })
			return await client.familyMembership.handle(interaction)
		}

		if (
			interaction.isButton() &&
			['capt_join', 'capt_leave'].includes(interaction.customId)
		) {
			return await captureManager.handleButton(interaction)
		}

		if (
			(interaction.isStringSelectMenu() &&
				interaction.customId.startsWith('capt_approve_')) ||
			(interaction.isButton() &&
				(interaction.customId.startsWith('capt_approval_page_') ||
					interaction.customId === 'capt_sort_toggle'))
		) {
			return await captureManager.handleApproval(interaction)
		}

		if (
			!interaction.isButton() &&
			!interaction.isModalSubmit() &&
			!interaction.isStringSelectMenu()
		)
			return

		const guild = interaction.guild
		if (!guild) return

		const customId = interaction.customId
		if (interaction.isModalSubmit() && customId.startsWith('modal_capture_preset_')) {
			if (!client.capturePresets) return interaction.reply({ content: 'Сборы временно недоступны.', flags: MessageFlags.Ephemeral })
			return await client.capturePresets.submit(interaction)
		}
		if (interaction.isButton() && customId === 'archive_show_notice') {
			if (!await authorize(interaction, dashboard)) return
			return await (require('../features/archive/archiveContextCommands') as typeof import('../features/archive/archiveContextCommands')).showNotice(interaction, interaction.message.content)
		}
		if (interaction.isModalSubmit() && customId === 'archive_notice') {
			if (!await authorize(interaction, dashboard)) return
			return interaction.reply({ content: 'Уведомление закрыто.', flags: MessageFlags.Ephemeral })
		}
		if (interaction.isButton() && (customId.startsWith('create_') || customId.startsWith('cancel_create_'))) {
			if (!await authorize(interaction, dashboard)) return
		}
		if ((interaction.isButton() && MOVED_BUTTON_IDS.has(customId)) ||
			(interaction.isStringSelectMenu() && customId === 'move_all_channel') ||
			(interaction.isModalSubmit() && ['modal_capt', 'modal_group_other'].includes(customId))) {
			const accessKey = customId === 'group' || customId === 'modal_group_other' ? 'ACCESS_GROUP_ROLES' : customId === 'move-all' || customId === 'move_all_channel' ? 'ACCESS_MOVE_ALL_ROLES' : undefined
			if (!await authorize(interaction, dashboard, accessKey)) return
		}

		// selects

		if (interaction.isStringSelectMenu()) {
			// The temporary role menu is acknowledged by its collector in inviteModeration.
			if (customId.startsWith('invite_select_additional_')) return
			if (customId === 'move_all_channel')
				return await moveAllInteractions.handleMoveAllSelect(interaction)
			if (customId.startsWith('invite_select_voice_'))
				return await handleVoiceSelect(interaction)
		}

		// buttons

		if (interaction.isButton()) {
			if (customId.startsWith('schedule_group_'))
				return await groupInteractions.showScheduledGroupModal(interaction)
			if (customId === 'open_invite_modal')
				return await inviteApplication.showModal(interaction)
			if (customId.startsWith('invite_'))
				return await handleModerationButton(interaction)

			if (customId === 'capt_edit_time_trigger') {
				return await captureInteractions.handleInlineEditTimeButton(interaction)
			}

			if (
				customId.startsWith('capt_') &&
				!['capt_join', 'capt_leave', 'capt_edit_time_trigger'].includes(
					customId
				)
			) {
				return await captureInteractions.handleAutoCaptButton(interaction)
			}

			if (customId === 'group')
				return await groupInteractions.showGroupModal(interaction)
			if (customId === 'capt')
				return await captureInteractions.showCaptModal(interaction)

			if (customId === 'move-all')
				return await moveAllInteractions.showMoveAllSelect(interaction)
			if (customId === 'cancel')
				return await archiveInteractions.cancelArchive(interaction)
			if (customId === 'archive_find') return await findArchive(interaction)
			if (customId.startsWith('create_') || customId.startsWith('cancel_create_'))
				return await archiveInteractions.handleDynamicButtons(interaction)
		}

		// modals

		if (interaction.isModalSubmit()) {
			if (customId === 'modal_capt') {
				return await captureInteractions.submitCaptModal(interaction)
			}

			if (customId.startsWith('modal_inline_edit_time_')) {
				return await captureInteractions.submitInlineEditTimeModal(interaction)
			}

			if (customId === 'invite_modal_submit')
				return await inviteApplication.submitModal(interaction)
			if (customId.startsWith('invite_modal_reject_'))
				return await submitRejectModal(interaction)
			if (customId.startsWith('modal_group_'))
				return await groupInteractions.submitGroupModal(interaction)
		}
		if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: 'Это действие устарело. Откройте актуальное сообщение бота.', flags: MessageFlags.Ephemeral })
		} catch (caught) {
			const error = getError(caught)
			console.error('[Interaction]', { id: interaction.id, customId: 'customId' in interaction ? interaction.customId : undefined, ageMs: Date.now() - interaction.createdTimestamp, elapsedMs: Math.round(performance.now() - startedAt), acknowledged: interaction.deferred || interaction.replied, code: error.code, message: error.message })
			if (error.code === 10062 || error.code === 40060) return
			try {
				const payload = { content: 'Не удалось выполнить действие. Попробуйте ещё раз.' }
				if (interaction.deferred) await interaction.editReply(payload)
				else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
				else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
			} catch (responseError) { console.error('[Interaction response]', getError(responseError).message) }
		}
	})
}
