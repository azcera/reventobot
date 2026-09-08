const {
	ContainerBuilder,
	TextDisplayBuilder,
	Guild,
	ChannelType,
	PermissionFlagsBits,
	SeparatorBuilder,
	MessageFlags
} = require('discord.js')
require('dotenv').config()

const adminChannelId = '1543180993786150992'
const adminPanelMessageId = '1545889525039898767'
const ADMIN_ROLES = process.env.ADMIN_ROLES
const archiveChannelId = process.env.PARENT_CHANNEL_ID

/**
 * Функция определяющая список неотвеченных архивов
 *
 * @param {Guild} guild
 * @returns {Promise<void>}
 */
async function updateUnansweredList(guild) {
	/**
	 * Список архивов без ответа
	 *
	 * @type {number[]}
	 */
	let unansweredList = []

	let archiveChannel =
		guild.channels.cache.get(archiveChannelId) ||
		(await guild.channels.fetch(archiveChannelId))

	if (!archiveChannel || archiveChannel?.type != ChannelType.GuildText) {
		return console.error('❌ Неправильно настроен канал с архивами.')
	}

	await archiveChannel.threads.fetchActive()

	for (const [_, thread] of archiveChannel.threads.cache) {
		try {
			const messages = await thread.messages.fetch({ limit: 1 })
			const lastMessage = messages.first()

			if (!lastMessage) continue

			const author = lastMessage.member
			if (!author) continue

			const hasUserMention = lastMessage.mentions.users.size > 0
			const hasRoleMention = lastMessage.mentions.roles.size > 0
			const hasEveryone = lastMessage.mentions.everyone

			const hasAnyMention = hasUserMention || hasRoleMention || hasEveryone
			const hasAdminRole =
				author.permissions.has(PermissionFlagsBits.Administrator) ||
				author.roles.cache.some(role => ADMIN_ROLES.includes(role.id))
			if (hasAnyMention && !hasAdminRole && !lastMessage.author.bot) {
				// условие при котором канал считается непрочитанным
				unansweredList.push(thread.id)
			}
		} catch (err) {
			console.error(`❌ Ошибка при обработке ветки ${thread.id}:`, err.message)
		}
	}

	const container = new ContainerBuilder()

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent('# 🙊 Список неотвеченных архивов')
	)

	let stringList = ''
	if (unansweredList.length === 0) {
		stringList = 'Нет непрочитанных архивов.'
	} else {
		unansweredList.forEach(
			(threadId, index) => (stringList += `${index + 1}. <#${threadId}>\n`)
		)
	}

	container
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(stringList))

	const adminChannel =
		guild.channels.cache.get(adminChannelId) ||
		(await guild.channels.fetch(adminChannelId))

	if (!adminChannel || adminChannel?.type != ChannelType.GuildText) {
		return console.error('❌ Неправильно настроен канал с панелью управления.')
	}

	const lastAdminMessage = (
		await adminChannel.messages.fetch({ limit: 1 })
	).first()

	if (lastAdminMessage?.id === adminPanelMessageId) {
		await adminChannel.send({
			components: [container],
			flags: [MessageFlags.IsComponentsV2]
		})
	} else {
		const unansweredListMessageId = (
			await adminChannel.messages.fetch({
				limit: 1,
				after: adminPanelMessageId
			})
		).first()

		if (!unansweredListMessageId) {
			return console.error('❌ Сообщение со списком неотвеченных не найдено.')
		}

		await unansweredListMessageId.edit({
			components: [container],
			flags: [MessageFlags.IsComponentsV2]
		})
	}
}

module.exports = { updateUnansweredList }
