import { getError } from '../../utils/errors'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	ChannelType,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	MessageFlags,
	TextDisplayBuilder,
	LabelBuilder,
	SeparatorBuilder
} from 'discord.js'
import {
	sendEphemeralWithAutoDelete,
	followUpEphemeralWithAutoDelete,
	editReplyWithAutoDelete
} from '../../utils/autoDelete.js'
import db = require('../../services/database.js')
import {
	isApplicationMod,
	logAction,
	buildContainer
} from '../../features/invite/inviteUtils.js'

const acceptingApplications = new Set<string>()

async function handleModerationButton(interaction: import('discord.js').ButtonInteraction<'cached'>) {
	const key = `${interaction.guildId}:${interaction.customId.split('_')[2]}`
	if (acceptingApplications.has(key)) {
		return sendEphemeralWithAutoDelete(interaction, {
			content: '⏳ Заявка уже обрабатывается. Дождитесь результата.'
		})
	}
	acceptingApplications.add(key)
	try {
		return await processModerationButton(interaction)
	} catch (caught) {
		console.error('[Invite] Ошибка загрузки заявки:', getError(caught))
		return sendEphemeralWithAutoDelete(interaction, {
			content: '❌ Не удалось загрузить заявку. Повторите попытку позже.'
		})
	} finally {
		acceptingApplications.delete(key)
	}
}

async function processModerationButton(interaction: import('discord.js').ButtonInteraction<'cached'>) {
	if (!isApplicationMod(interaction.member)) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ У вас нет прав для управления заявками!'
		})
	}

	const [_, actionType, targetUserId] = interaction.customId.split('_')

	if (actionType === 'reject') {
		const modal = new ModalBuilder()
			.setCustomId(`invite_modal_reject_${targetUserId}`)
			.setTitle('Причина отклонения')
		const inputLabel = new LabelBuilder()
			.setLabel('Укажите причину отказа кандидату')
			.setTextInputComponent(
				new TextInputBuilder()
					.setCustomId('reject_reason')
					.setPlaceholder('Пример: Ошибки в анкете')
					.setStyle(TextInputStyle.Short)
					.setRequired(true)
			)
		modal.addLabelComponents(inputLabel)

		return interaction.showModal(modal)
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral })
	const res = await db.query(
		`SELECT * FROM family_applications WHERE user_id = $1`,
		[targetUserId.trim()]
	)

	const appData = res.rows[0]
	if (appData && appData.channel_id !== interaction.channelId) {
		return editReplyWithAutoDelete(interaction, {
			content: '❌ Эта кнопка относится к устаревшей заявке. Откройте текущий канал заявки.'
		})
	}
	if (!appData && actionType !== 'accept') {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: `❌ Данные о заявке пользователя <@${targetUserId}> не найдены в базе данных.`
		})
	}


	if (actionType === 'accept') {
		// 1. СРАЗУ отвечаем на взаимодействие, чтобы Discord не считал его "зависшим" (Unknown interaction)
		// The action was acknowledged before database access.

		try {
			// При утрате записи сохраняем исходную анкету из доверенного сообщения бота.
			let logContainer: ContainerBuilder
			if (appData) {
				logContainer = await buildContainer(
					targetUserId, appData.full_name, appData.age,
					appData.about_and_expectations, appData.previous_experience,
					'принятия', interaction.user.id
				)
			} else {
				const source = interaction.message
				const container = source.components[0]?.toJSON()
				if (source.author.id !== interaction.client.user.id || source.webhookId ||
					source.channelId !== interaction.channelId || source.components.length !== 1 ||
					container?.type !== 17 || !container.components.some(component =>
						component.type === 1 && component.components.some(button =>
							button.type === 2 && 'custom_id' in button &&
							button.custom_id === interaction.customId && !button.disabled))) {
					return editReplyWithAutoDelete(interaction, {
						content: '❌ Запись заявки отсутствует, а исходную анкету подтвердить не удалось. Автоматическое принятие остановлено.'
					})
				}
				logContainer = new ContainerBuilder({
					...container,
					components: container.components.filter(component => component.type !== 1)
				}).setAccentColor(0x2ecc71).addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`✅ Заявка <@${targetUserId}> принята модератором <@${interaction.user.id}>. Запись в БД отсутствовала; сохранена исходная анкета.`)
				)
				console.warn('[Invite] Принятие заявки без записи в БД:', { userId: targetUserId, channelId: interaction.channelId })
			}
			// Проверяем ограничения Discord до выдачи роли и отправки уведомлений.
			logContainer.toJSON()

			const targetMember = await interaction.guild.members
				.fetch(targetUserId)
				.catch(() => null)
			if (targetMember) {
				// Используем MAIN_ROLE_ID, если он есть, иначе fallback на AUTO_ROLE
				const roleId = String(
					dashboard.getSetting('MAIN_ROLE_ID') || dashboard.getSetting('AUTO_ROLE')
				).trim()
				await targetMember.roles.add(roleId)
			}

			const targetUser = await interaction.client.users
				.fetch(targetUserId)
				.catch(() => null)
			if (targetUser) {
				const container = new ContainerBuilder()
					.setAccentColor(0x2ecc71)
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard.text('dm.document.accepted', { server: interaction.guild.name, time: Math.floor(Date.now() / 1000) })))

				await targetUser
					.send({
						components: [container.toJSON()],
						flags: MessageFlags.IsComponentsV2 as const
					})
					.catch(() => {})
			}
			await logAction(interaction.guild, logContainer)

			// Если удаление канала не удастся, повторно принять заявку уже нельзя.
			await interaction.message.edit({
				components: [logContainer.toJSON()],
				flags: MessageFlags.IsComponentsV2 as const
			})

			// Удаляем из БД
			await db.query('DELETE FROM family_applications WHERE user_id = $1 AND channel_id = $2', [
				targetUserId, interaction.channelId
			])

			await followUpEphemeralWithAutoDelete(interaction, {
				content: `✅ Заявка <@${targetUserId}> одобрена! Канал будет удален через 5 секунд.`
			})
			setTimeout(
				() => interaction.channel?.delete().catch(console.error),
				5000
			)
		} catch (caught) {
 const error = getError(caught);
			console.error('Ошибка при принятии заявки:', error)
			await followUpEphemeralWithAutoDelete(interaction, {
				content: '❌ Произошла ошибка при обработке заявки.'
			})
		}
	}

	if (actionType === 'interview') {
		// The action was acknowledged before database access.

		const voiceChannels = interaction.guild.channels.cache.filter(
			c => c.type === ChannelType.GuildVoice && c.name.includes('📞')
		)

		if (voiceChannels.size === 0) {
			return editReplyWithAutoDelete(interaction, {
				content: '❌ Нет подходящих голосовых каналов.'
			})
		}

		// 1. СРАЗУ делаем кнопку неактивной, используя встроенную логику buildContainer
		const disabledContainer = await buildContainer(
			targetUserId,
			appData.full_name,
			appData.age,
			appData.about_and_expectations,
			appData.previous_experience,
			'отправления',
			null,
			null,
			true // isInterviewDisabled = true (кнопка станет серой)
		)

		const mainMessage = interaction.message
		// Обновляем сообщение новыми компонентами
		await mainMessage
			.edit({
				components: [disabledContainer.toJSON()],
				flags: MessageFlags.IsComponentsV2 as const
			})
			.catch(console.error)

		// 2. Показываем меню выбора канала
		const selectMenu = new StringSelectMenuBuilder()
			.setCustomId(`invite_select_voice_${targetUserId}`)
			.setPlaceholder('Выберите голосовой канал')

		voiceChannels.forEach(c =>
			selectMenu.addOptions(
				new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.id)
			)
		)

		await editReplyWithAutoDelete(interaction, {
			content: 'Выберите комнату для кандидата (меню активно 1 минуту):',
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)]
		})

		// 3. Собираем выбор администратора
		const collector = interaction.channel!.createMessageComponentCollector({
			filter: i =>
				i.user.id === interaction.user.id &&
				i.customId === `invite_select_voice_${targetUserId}`,
			time: 60000,
			max: 1
		})

		collector.on('collect', async () => {
			await interaction.deleteReply().catch(() => {}) // Удаляем сообщение с меню выбора, чтобы не мешало
		})

		collector.on('end', async collected => {
			if (collected.size === 0) {
				// Время вышло. Возвращаем кнопку "Обзвон" в активное состояние
				const enabledContainer = await buildContainer(
					targetUserId,
					appData.full_name,
					appData.age,
					appData.about_and_expectations,
					appData.previous_experience,
					'отправления',
					null,
					null,
					false // isInterviewDisabled = false (кнопка снова активна)
				)
				await mainMessage
					.edit({
						components: [enabledContainer.toJSON()],
						flags: MessageFlags.IsComponentsV2 as const
					})
					.catch(console.error)

				// ИСПРАВЛЕНИЕ: Сообщение видно ТОЛЬКО администратору (Ephemeral)
				await followUpEphemeralWithAutoDelete(interaction, {
					content: `⏳ Время выбора комнаты истекло. Кнопка вызова снова активна.`
				})
			}
		})
		return
	}
}
export { handleModerationButton }
