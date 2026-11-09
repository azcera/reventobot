const { MessageFlags } = require('discord.js')
const { store: dashboard } = require('../dashboard/store')
const { authorize, MOVED_BUTTON_IDS } = require('../services/adminApplicationCommands')
const captureManager = require('../features/capture/captureManager')
const groupInteractions = require('../features/capture/groupInteractions')
const captureInteractions = require('../features/capture/captureInteractions')
const archiveInteractions = require('../features/archive/archiveInteractions')
const moveAllInteractions = require('../features/moveAll/moveAllInteractions')
const inviteApplication = require('../features/invite/inviteApplication')
const {
	handleModerationButton
} = require('../features/invite/inviteModeration')
const { handleVoiceSelect } = require('../features/invite/inviteVoiceSelect')
const submitRejectModal = require('../features/invite/inviteModalHandler')
const { findArchive } = require('../features/archive/archiveSearch')
const {
	followUpEphemeralWithAutoDelete,
	replyWithAutoDelete
} = require('../utils/autoDelete')

module.exports = client => {
	client.on('interactionCreate', async interaction => {
		if (interaction.isChatInputCommand() || interaction.isUserContextMenuCommand()) {
			const command = client.commands.get(interaction.commandName)
			if (!command) return
			try {
				await command.execute(interaction)
			} catch (error) {
				console.error(error)
				if (error?.code === 10062) return
				if (!interaction.replied && !interaction.deferred && Date.now() - interaction.createdTimestamp >= 3000) return
				const payload = {
					content: '❌ Произошла ошибка при запуске команды!',
					flags: [MessageFlags.Ephemeral]
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
			return client.familyWars.handle(interaction)
		}

		if (interaction.customId?.startsWith('mcl_') && (interaction.isButton() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu())) {
			if (!client.mclLists) return interaction.reply({ content: 'Списки временно недоступны.', flags: MessageFlags.Ephemeral })
			try { await client.mclLists.handle(interaction) }
			catch (error) { console.error('[Lists] Ошибка обработки:', error); if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Не удалось выполнить действие.', flags: MessageFlags.Ephemeral }) }
			return
		}

		if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('family_cleanup_')) {
			if (!client.familyMembership) return interaction.reply({ content: 'Проверка семьи ещё не готова.', flags: MessageFlags.Ephemeral })
			return client.familyMembership.handle(interaction)
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
		if (interaction.isButton() && customId === 'archive_show_notice') {
			if (!await authorize(interaction, dashboard)) return
			return require('../features/archive/archiveContextCommands').showNotice(interaction, interaction.message.content)
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
			if (!await authorize(interaction, dashboard)) return
		}

		// selects

		if (interaction.isStringSelectMenu()) {
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
			if (customId.includes('_'))
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
	})
}
