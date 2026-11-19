import db = require('../../services/database')
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'

/**
 * Проверка, является ли пользователь администратором заявок
 *
 * @param {GuildMember} member
 * @returns {boolean}
 */
function isApplicationMod(member: import('discord.js').GuildMember) {
	return (
		member?.roles.cache.some(role =>
			dashboard.roleIds('ADMIN_ROLES').includes(role.id)
		) ||
		member?.permissions.has(PermissionFlagsBits.Administrator) ||
		member?.permissions.has(PermissionFlagsBits.ManageRoles) ||
		false
	)
}

/**
 * Централизованная отправка логов в аудит-канал
 *
 * @param {GuildMember} guild
 * @param {ContainerBuilder} container
 * @returns {Promise<void>}
 */
async function logAction(
	guild: import('discord.js').Guild,
	container: import('discord.js').ContainerBuilder
) {
	const logChannelId = dashboard.getSetting('LOG_CHANNEL_ID')
	if (!logChannelId) return
	const logChannel = guild.channels.cache.get(logChannelId)
	if (logChannel?.isSendable()) {
		await logChannel
			.send({
				components: [container.toJSON()],
				flags: MessageFlags.IsComponentsV2 as const
			})
			.catch(err => console.error('[Log Error]', err))
	}
}

// Хранилище цветов для админских действий
const colors = {
	green: 0x2ecc71,
	red: 0xe74c3c,
	orange: 0xe67e22
}

// Универсальный сборщик контейнеров (V2 Components)
/**
 * Description
 *
 * @param {number} userId
 * @param {string} fullName
 * @param {number} age
 * @param {string} aboutAndExpectations
 * @param {string} previousExperience
 * @param {string} action
 * @param {string?} adminId
 * @param {string?} extraInfo
 * @param {boolean?} isInterviewDisabled
 * @returns {Promise<ContainerBuilder>}
 */
async function buildContainer(
	userId: string,
	fullName: string,
	age: number,
	aboutAndExpectations: string,
	previousExperience: string,
	action: string,
	adminId: string | null = null,
	extraInfo: string | null = null,
	isInterviewDisabled: boolean = false
) {
	const timestamp = Math.floor(Date.now() / 1000)
	const state =
		{
			отправления: 'pending',
			принятия: 'accepted',
			отклонения: 'rejected',
			обзвона: 'interview'
		}[action] || 'pending'
	let content = dashboard.text('application.document.' + state, {
		user: userId,
		name: fullName,
		age,
		about: aboutAndExpectations,
		history: previousExperience,
		admin: adminId,
		time: timestamp,
		reason: extraInfo || 'Не указана',
		channel: extraInfo
	})
	if (state === 'pending' && dashboard.roleIds('ADMIN_ROLES').length)
		content +=
			'\n' +
			dashboard
				.roleIds('ADMIN_ROLES')
				.map(role => `<@&${role}>`)
				.join(' ')
	const container = new ContainerBuilder().addTextDisplayComponents(
		new TextDisplayBuilder().setContent(content)
	)
	const accentColor = {
		accepted: colors.green,
		rejected: colors.red,
		interview: colors.orange
	}[state]
	if (accentColor) container.setAccentColor(accentColor)

	if (action === 'отправления') {
		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`invite_accept_${userId}`)
				.setLabel(dashboard.text('application.1'))
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`invite_interview_${userId}`)
				.setLabel(dashboard.text('application.2'))
				.setStyle(ButtonStyle.Primary)
				.setDisabled(isInterviewDisabled),
			new ButtonBuilder()
				.setCustomId(`invite_reject_${userId}`)
				.setLabel(dashboard.text('application.3'))
				.setStyle(ButtonStyle.Danger)
		)

		container
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addActionRowComponents(actionRow)
	}
	return container
}

async function finishApplicationChannel(
	guild: import('discord.js').Guild,
	channelId: string
) {
	const params = [guild.id, channelId]
	const filter =
		"guild_id = $1 AND channel_id = $2 AND status IN ('accepted', 'rejected')"
	if (
		!(
			await db.query(
				`SELECT user_id FROM family_applications WHERE ${filter}`,
				params
			)
		).rows.length
	)
		return
	try {
		const channel = await guild.channels.fetch(channelId, { force: true })
		await channel?.delete()
	} catch (error) {
		if (Number((error as { code?: unknown })?.code) !== 10003) throw error
	}
	await db.query(`DELETE FROM family_applications WHERE ${filter}`, params)
}

const applicationTopic = (id: string) => 'Revento application ' + id

async function recoverApplicationCreations(guild: import('discord.js').Guild) {
	const { rows } = await db.query(
		`SELECT * FROM family_applications WHERE guild_id = $1
		AND status IN ('creating', 'creation_failed') AND creation_id IS NOT NULL
		AND created_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes'`,
		[guild.id]
	)
	if (!rows.length) return
	const channels = await guild.channels.fetch()
	for (const row of rows) {
		try {
			const channel =
				(row.channel_id ? channels.get(row.channel_id) : undefined) ||
				channels.find(
					channel =>
						channel?.type === ChannelType.GuildText &&
						channel.topic === applicationTopic(row.creation_id)
				)
			if (!channel || channel.type !== ChannelType.GuildText) {
				await db.query(
					`DELETE FROM family_applications WHERE creation_id = $1
					AND status IN ('creating', 'creation_failed')`,
					[row.creation_id]
				)
				continue
			}
			let message: import('discord.js').Message | undefined
			let after = row.creation_id
			for (;;) {
				const batch = await channel.messages.fetch({
					after,
					limit: 100,
					cache: false
				})
				message = batch.find(
					candidate =>
						candidate.author.id === guild.client.user.id &&
						!candidate.webhookId &&
						candidate.components.some(
							container =>
								container.type === 17 &&
								container.components.some(
									component =>
										component.type === 1 &&
										component.components.some(
											button =>
												button.type === 2 &&
												'customId' in button &&
												button.customId === 'invite_accept_' + row.user_id
										)
								)
						)
				)
				if (message || batch.size < 100) break
				const latest = [...batch.keys()].reduce((a, b) =>
					BigInt(a) > BigInt(b) ? a : b
				)
				if (BigInt(latest) <= BigInt(after))
					throw new Error('Не удалось прочитать историю заявки.')
				after = latest
			}
			if (!message) {
				const container = await buildContainer(
					row.user_id,
					row.full_name,
					row.age,
					row.about_and_expectations,
					row.previous_experience,
					'отправления'
				)
				message = await channel.send({
					components: [container.toJSON()],
					flags: MessageFlags.IsComponentsV2,
					nonce: row.creation_id,
					enforceNonce: true
				})
			}
			await db.query(
				`UPDATE family_applications SET channel_id = $2, message_id = $3, status = 'pending'
				WHERE creation_id = $1 AND status IN ('creating', 'creation_failed')`,
				[row.creation_id, channel.id, message.id]
			)
		} catch (error) {
			console.error('[Invite creation recovery]', error)
		}
	}
}

export {
	applicationTopic,
	buildContainer,
	finishApplicationChannel,
	isApplicationMod,
	logAction,
	recoverApplicationCreations
}
