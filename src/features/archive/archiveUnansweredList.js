const { store: dashboard } = require('../../dashboard/store')
const { ContainerBuilder } = require('../../services/markdownContainer')
const {
	TextDisplayBuilder,
	Guild,
	ChannelType,
	PermissionFlagsBits,
	MessageType,
	SeparatorBuilder
} = require('discord.js')
require('dotenv').config()

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000 // 7 дней в миллисекундах

/**
 * Функция определяющая список неотвеченных архивов
 *
 * @param {Guild} guild
 */
async function getUnansweredList(guild) {
	/**
	 * Список архивов без ответа
	 *
	 * @type {{id: number, name: string}[]}
	 */
	let unansweredList = []

	let archiveChannel =
		guild.channels.cache.get(dashboard.getSetting('PARENT_CHANNEL_ID')) ||
		(await guild.channels.fetch(dashboard.getSetting('PARENT_CHANNEL_ID')))

	if (!archiveChannel || archiveChannel?.type != ChannelType.GuildText) {
		console.error('❌ Неправильно настроен канал с архивами.')
		return
	}

	const { threads } = await archiveChannel.threads.fetchActive(true)

	for (const [_, thread] of archiveChannel.threads.cache) {
		try {
			const messages = await thread.messages.fetch({ limit: 1 })
			const lastMessage = messages.first()

			if (!lastMessage) continue

			const messageAge = Date.now() - lastMessage.createdTimestamp
			if (messageAge > SEVEN_DAYS) continue

			const author =
				lastMessage.member ??
				(await thread.guild.members
					.fetch(lastMessage.author.id)
					.catch(() => null))
			if (!author) continue

			const hasRoleMention = lastMessage.mentions.roles.size > 0
			const hasEveryone = lastMessage.mentions.everyone

			const isReply = lastMessage.type === MessageType.Reply

			let hasUserMention = lastMessage.mentions.users.size > 0

			if (isReply && hasUserMention) {
					const repliedUserId = lastMessage.mentions.repliedUser?.id

					if (repliedUserId) {
							const realMentions = lastMessage.mentions.users.filter(user => user.id !== repliedUserId)
					
							hasUserMention = realMentions.size > 0
					}
			}

			const hasAnyMention = hasUserMention || hasRoleMention || hasEveryone
			const hasAdminRole =
				author.permissions.has(PermissionFlagsBits.Administrator) ||
				author.roles.cache.some(role => dashboard.roleIds('ADMIN_ROLES').includes(role.id))

			if ((!lastMessage.author.bot && hasAnyMention) || !hasAdminRole) {
				// условие при котором канал считается непрочитанным
				unansweredList.push({
					id: thread.id,
					name: thread.name
				})
			}
		} catch (err) {
			console.error(`❌ Ошибка при обработке ветки ${thread.id}:`, err.message)
		}
	}

	const container = new ContainerBuilder()

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(dashboard.text('unanswered.1'))
	)

	let stringList = ''
	if (unansweredList.length === 0) {
		stringList = dashboard.text('unanswered.empty')
	} else {
		unansweredList.sort((a, b) => {
			const numA = Number(String(a.name).match(/(\d+)\s*$/)?.[1] ?? 0)
			const numB = Number(String(b.name).match(/(\d+)\s*$/)?.[1] ?? 0)
			return numA - numB
		})
		unansweredList.forEach(
			(thread, index) => (stringList += `${index + 1}. <#${thread.id}>\n`)
		)
	}

	container
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(stringList))
	return dashboard.decorate('unanswered', container)
}

module.exports = { getUnansweredList }
