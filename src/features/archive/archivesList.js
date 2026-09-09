const {
	GuildMember,
	Guild,
	GuildChannel,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder
} = require('discord.js')
const { listsSend } = require('../../utils/listsSend')
const { parseDisplayName } = require('../../utils/parseDisplayName')

require('dotenv').config()

const rolesToGroup = process.env.ARCHIVE_GROUP_ROLES.split(',')
const autoRoleId = process.env.AUTO_ROLE

/**
 * Обновляет сообщение со списком всех участников и их архивов
 *
 * @param {Guild} guild
 */
async function updateArchivesList(guild) {
	await guild.members.fetch()

	/**
	 * @type {Object.<string, Array<{member: GuildMember, archiveChannel: GuildChannel|null}>>}
	 */
	const groupings = {}
	rolesToGroup.forEach(roleId => {
		groupings[roleId] = []
	})

	const filteredMembers = guild.members.cache.filter(
		member => member.roles.cache.has(autoRoleId) && !member.user.bot
	)

	const guildChannels = (await guild.channels.fetch()).filter(ch =>
		ch.isThread()
	)

	filteredMembers.forEach(member => {
		const sortedMemberRoles = member.roles.cache.sort(
			(a, b) => b.position - a.position
		)

		const highestMatchingRole = sortedMemberRoles.find(role =>
			rolesToGroup.includes(role.id)
		)

		const parsedDisplayName = parseDisplayName(member.displayName)

		let archiveChannel = guildChannels.find(
			ch =>
				ch.name ===
				[
					'archive',
					parsedDisplayName.memberName,
					parsedDisplayName.memberStatic
				].join(' ')
		)

		if (!archiveChannel) archiveChannel = null

		const archiveMember = {
			member,
			archiveChannel
		}

		if (highestMatchingRole) {
			groupings[highestMatchingRole.id].push(archiveMember)
		}
	})

	const container = new ContainerBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('# 👥 Список участников и их архивов')
		)
		.addSeparatorComponents(new SeparatorBuilder())

	const MAX_TEXT_LENGTH = 3800 // с запасом

	for (const key of Object.keys(groupings)) {
		if (!groupings[key].length) continue

		const role =
			guild.roles.cache.get(key) ||
			(await guild.roles.fetch(key).catch(() => null))

		if (!role) continue

		// Собираем строки
		const lines = groupings[key].map((item, index) => {
			const channelText = item.archiveChannel
				? `<#${item.archiveChannel.id}>`
				: 'нет архива'

			return `${index + 1}. <@${item.member.id}> -----> ${channelText}`
		})

		// Первый кусок начинается с заголовка роли
		let currentChunk = `## <@&${role.id}>:\n`

		for (const line of lines) {
			const lineWithNewline = line + '\n'

			if (currentChunk.length + lineWithNewline.length > MAX_TEXT_LENGTH) {
				// Отправляем текущий кусок
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(currentChunk)
				)
				container.addSeparatorComponents(new SeparatorBuilder())

				// Начинаем новый кусок без заголовка роли
				currentChunk = lineWithNewline
			} else {
				currentChunk += lineWithNewline
			}
		}

		// Добавляем последний кусок
		if (currentChunk.trim().length > 0) {
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(currentChunk)
			)
			container.addSeparatorComponents(new SeparatorBuilder())
		}
	}

	// Проверяем перед отправкой (для отладки)
	console.log(
		'Количество компонентов в контейнере:',
		container.components?.length ?? 'неизвестно'
	)

	await listsSend(guild, 2, container)
}

module.exports = { updateArchivesList }
