import {
	ActionRowBuilder,
	ChannelType,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import {
	buildContainer,
	isApplicationMod,
	logAction
} from '../../features/invite/inviteUtils.js'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	editReplyWithAutoDelete,
	followUpEphemeralWithAutoDelete,
	sendEphemeralWithAutoDelete
} from '../../utils/autoDelete.js'
import { createArchiveChannel } from '../../utils/channelUtils'
import { getError } from '../../utils/errors'
import { parseDisplayName } from '../../utils/parseDisplayName'
import { findMemberArchive } from '../archive/archiveSearch'
import { finishApplicationChannel } from './inviteUtils'
import { sendInterviewInvite } from './inviteVoiceSelect'
import db = require('../../services/database.js')

const acceptingApplications = new Set<string>()

async function handleModerationButton(
	interaction: import('discord.js').ButtonInteraction<'cached'>
) {
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

async function processModerationButton(
	interaction: import('discord.js').ButtonInteraction<'cached'>
) {
	if (!isApplicationMod(interaction.member)) {
		return await sendEphemeralWithAutoDelete(interaction, {
			content: '❌ У вас нет прав для управления заявками!'
		})
	}

	const [_, actionType, targetUserId] = interaction.customId.split('_')

	if (actionType === 'reject') {
		const modal = new ModalBuilder()
			.setCustomId(
				`invite_modal_reject_${targetUserId}_${interaction.guildId}_${interaction.channelId}`
			)
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
	if (
		appData &&
		(appData.channel_id !== interaction.channelId ||
			(appData.guild_id && appData.guild_id !== interaction.guildId) ||
			((appData.status ?? 'pending') !== 'pending' &&
				!(actionType === 'accept' && appData.status === 'accept_failed')))
	) {
		return editReplyWithAutoDelete(interaction, {
			content:
				'❌ Эта кнопка относится к устаревшей заявке. Откройте текущий канал заявки.'
		})
	}
	if (!appData && actionType !== 'accept') {
		return await editReplyWithAutoDelete(interaction, {
			content: `❌ Данные о заявке пользователя <@${targetUserId}> не найдены в базе данных.`
		})
	}

	if (actionType === 'accept') {
		let claimed = false
		try {
			let logContainer: ContainerBuilder
			if (appData?.full_name) {
				logContainer = await buildContainer(
					targetUserId,
					appData.full_name,
					appData.age,
					appData.about_and_expectations,
					appData.previous_experience,
					'принятия',
					interaction.user.id
				)
			} else {
				const source = interaction.message
				const container = source.components[0]?.toJSON()
				if (
					source.author.id !== interaction.client.user.id ||
					source.webhookId ||
					source.channelId !== interaction.channelId ||
					source.components.length !== 1 ||
					container?.type !== 17 ||
					!container.components.some(
						component =>
							component.type === 1 &&
							component.components.some(
								button =>
									button.type === 2 &&
									'custom_id' in button &&
									button.custom_id === interaction.customId &&
									!button.disabled
							)
					)
				) {
					return editReplyWithAutoDelete(interaction, {
						content:
							'❌ Запись заявки отсутствует, а исходную анкету подтвердить не удалось. Автоматическое принятие остановлено.'
					})
				}
				logContainer = new ContainerBuilder({
					...container,
					components: container.components.filter(
						component => component.type !== 1
					)
				})
					.setAccentColor(0x2ecc71)
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`✅ Заявка <@${targetUserId}> принята модератором <@${interaction.user.id}>. Запись в БД отсутствовала; сохранена исходная анкета.`
						)
					)
			}
			logContainer.toJSON()
			const values = [targetUserId, interaction.channelId, interaction.guildId]
			const claim = appData
				? await db.query(
						`UPDATE family_applications SET status = 'accepting', guild_id = $3, modified_at = NOW()
				WHERE user_id = $1 AND channel_id = $2 AND (guild_id IS NULL OR guild_id = $3)
				AND COALESCE(status, 'pending') IN ('pending', 'accept_failed') RETURNING user_id`,
						values
					)
				: await db.query(
						`INSERT INTO family_applications
					(user_id, channel_id, guild_id, full_name, age, about_and_expectations, previous_experience, status)
					VALUES ($1, $2, $3, '', 0, '', '', 'accepting') ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
						values
					)
			if (!claim.rows.length)
				return editReplyWithAutoDelete(interaction, {
					content: '❌ Заявка уже обработана или недоступна.'
				})
			claimed = true

			const targetMember = await interaction.guild.members
				.fetch(targetUserId)
				.catch(() => null)
			if (targetMember) {
				// Используем MAIN_ROLE_ID, если он есть, иначе fallback на AUTO_ROLE
				const roleId = String(
					dashboard.getSetting('MAIN_ROLE_ID') ||
						dashboard.getSetting('AUTO_ROLE')
				).trim()
				await targetMember.roles.add(roleId)
				const parsed =
					parseDisplayName(targetMember.displayName) ||
					parseDisplayName(appData?.full_name)
				if (!parsed)
					throw new Error(
						'Не удалось определить имя и статик для создания архива.'
					)
				if (!(await findMemberArchive(interaction.guild, parsed))) {
					await createArchiveChannel(interaction.guild, {
						channelName: [
							'archive',
							parsed.memberName.toLowerCase(),
							parsed.memberStatic
						].join(' '),
						member: targetMember
					})
				}
			}

			const targetUser = await interaction.client.users
				.fetch(targetUserId)
				.catch(() => null)
			if (targetUser) {
				const container = new ContainerBuilder()
					.setAccentColor(0x2ecc71)
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							dashboard.text('dm.document.accepted', {
								server: interaction.guild.name,
								time: Math.floor(Date.now() / 1000)
							})
						)
					)

				await targetUser
					.send({
						components: [container.toJSON()],
						flags: MessageFlags.IsComponentsV2 as const
					})
					.catch(() => {})
			}
			await logAction(interaction.guild, logContainer)

			const completed = await db.query(
				`UPDATE family_applications SET status = 'accepted', modified_at = NOW()
				WHERE user_id = $1 AND channel_id = $2 AND status = 'accepting' RETURNING user_id`,
				[targetUserId, interaction.channelId]
			)
			if (!completed.rows.length)
				throw new Error('Не удалось подтвердить принятие заявки.')
			// Если удаление канала не удастся, повторно принять заявку уже нельзя.
			await interaction.message
				.edit({
					components: [logContainer.toJSON()],
					flags: MessageFlags.IsComponentsV2 as const
				})
				.catch(console.error)

			await followUpEphemeralWithAutoDelete(interaction, {
				content: `✅ Заявка <@${targetUserId}> одобрена! Канал будет удалён через 5 секунд.`
			})
			setTimeout(
				() =>
					finishApplicationChannel(
						interaction.guild,
						interaction.channelId
					).catch(console.error),
				5000
			).unref()
		} catch (caught) {
			const error = getError(caught)
			console.error('Ошибка при принятии заявки:', error)
			if (claimed)
				await db
					.query(
						`UPDATE family_applications SET status = 'accept_failed', modified_at = NOW()
				WHERE user_id = $1 AND channel_id = $2 AND status = 'accepting'`,
						[targetUserId, interaction.channelId]
					)
					.catch(console.error)
			await followUpEphemeralWithAutoDelete(interaction, {
				content: '❌ Произошла ошибка при обработке заявки.'
			})
		}
	}

	if (actionType === 'interview') {
		// The action was acknowledged before database access.

		const everyone = interaction.guild.roles.everyone
		const voiceChannels = interaction.guild.channels.cache.filter(
			channel =>
				channel.type === ChannelType.GuildVoice &&
				channel.name.includes('📞') &&
				channel.permissionsFor(everyone).has([
					PermissionFlagsBits.ViewChannel,
					PermissionFlagsBits.Connect
				])
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

		const voiceChannel = voiceChannels.first()
		if (voiceChannels.size === 1 && voiceChannel) {
			return sendInterviewInvite(
				interaction,
				targetUserId,
				voiceChannel.id,
				appData
			)
		}

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
			components: [
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					selectMenu
				)
			]
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
