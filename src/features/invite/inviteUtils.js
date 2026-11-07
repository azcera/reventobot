const { store: dashboard } = require('../../dashboard/store')
const {
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	SeparatorSpacingSize,
	MessageFlags,
	GuildMember,
	PermissionFlagsBits
} = require('discord.js')


/**
 * Проверка, является ли пользователь администратором заявок
 *
 * @param {GuildMember} member
 * @returns {boolean}
 */
function isApplicationMod(member) {
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
async function logAction(guild, container) {
	const logChannelId = dashboard.getSetting('LOG_CHANNEL_ID')
	if (!logChannelId) return
	const logChannel = guild.channels.cache.get(logChannelId)
	if (logChannel) {
		await logChannel
			.send({
				components: [container.toJSON()],
				flags: [MessageFlags.IsComponentsV2]
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
	userId,
	fullName,
	age,
	aboutAndExpectations,
	previousExperience,
	action,
	adminId = null,
	extraInfo = null,
	isInterviewDisabled = false
) {
	const timestamp = Math.floor(Date.now() / 1000)
	let accentColor = null // Изначально цвета нет
	let title = dashboard.text('application.title')
	let statusText = dashboard.text('application.pendingStatus', { time: timestamp })

	// Динамическая сборка содержимого на основе действия модерации
	if (action === 'отправления') {
		title +=
			dashboard.text('application.help')
		if (Array.isArray(dashboard.roleIds('ADMIN_ROLES')) && dashboard.roleIds('ADMIN_ROLES').length > 0) {
			statusText += '\n' + dashboard.roleIds('ADMIN_ROLES').map(role => `<@&${role}>`).join(' ')
		}
	} else if (action === 'принятия') {
		accentColor = colors.green
		title = dashboard.text('application.accepted')
		statusText = dashboard.text('application.acceptedStatus', { admin: adminId, time: timestamp })
	} else if (action === 'отклонения') {
		accentColor = colors.red
		title = dashboard.text('application.rejected')
		statusText = dashboard.text('application.rejectedStatus', { admin: adminId, reason: extraInfo || 'Не указана', time: timestamp })
	} else if (action === 'обзвона') {
		accentColor = colors.orange
		title = dashboard.text('application.interview')
		statusText = dashboard.text('application.interviewStatus', { admin: adminId, channel: extraInfo, time: timestamp })
	}

	const container = new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				dashboard.text('application.details', { user: userId, name: fullName, age, about: aboutAndExpectations, history: previousExperience })
			)
		)
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText))

	// Накладываем цветную полоску ТОЛЬКО если это админское действие (принятие/отказ/обзвон)
	if (accentColor) {
		container.setAccentColor(accentColor)
	}

	if (action === 'отправления') {
		const actionRow = new ActionRowBuilder().addComponents(
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

module.exports = { isApplicationMod, logAction, buildContainer }
