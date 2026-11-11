import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	TextDisplayBuilder,
	SeparatorBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	SeparatorSpacingSize,
	MessageFlags,
	GuildMember,
	PermissionFlagsBits
} from 'discord.js'


/**
 * Проверка, является ли пользователь администратором заявок
 *
 * @param {GuildMember} member
 * @returns {boolean}
 */
function isApplicationMod(member: import('discord.js').GuildMember) {
	return (
		member?.roles.cache.some(role => dashboard.roleIds('ADMIN_ROLES').includes(role.id)) ||
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
async function logAction(guild: import('discord.js').Guild, container: import('discord.js').ContainerBuilder) {
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
	const state = { 'отправления': 'pending', 'принятия': 'accepted', 'отклонения': 'rejected', 'обзвона': 'interview' }[action] || 'pending'
	let content = dashboard.text('application.document.' + state, { user: userId, name: fullName, age, about: aboutAndExpectations, history: previousExperience, admin: adminId, time: timestamp, reason: extraInfo || 'Не указана', channel: extraInfo })
	if (state === 'pending' && dashboard.roleIds('ADMIN_ROLES').length) content += '\n' + dashboard.roleIds('ADMIN_ROLES').map(role => `<@&${role}>`).join(' ')
	const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
	const accentColor = { accepted: colors.green, rejected: colors.red, interview: colors.orange }[state]
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

export { isApplicationMod, logAction, buildContainer }
