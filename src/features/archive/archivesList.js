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

	for (const key of Object.keys(groupings)) {
		if (!groupings[key].length) continue

		const role =
			guild.roles.cache.get(key) ||
			(await guild.roles.fetch(key).catch(() => null))

		if (!role) continue

		// Собираем все строки
		const lines = groupings[key].map((item, index) => {
			const channelText = item.archiveChannel
				? `<#${item.archiveChannel.id}>`
				: 'нет архива'

			return `${index + 1}. <@${item.member.id}> -----> ${channelText}`
		})

		// Разбиваем на куски по ~3800 символов (с запасом)
		const chunks = []
		let currentChunk = `## <@&${role.id}>:\n`

		for (const line of lines) {
			// +1 на перенос строки
			if (currentChunk.length + line.length + 1 > 3800) {
				chunks.push(currentChunk)
				currentChunk = line + '\n'
			} else {
				currentChunk += line + '\n'
			}
		}

		if (currentChunk.trim()) {
			chunks.push(currentChunk)
		}

		// Добавляем каждый кусок отдельным TextDisplay
		for (const chunk of chunks) {
			container
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk))
				.addSeparatorComponents(new SeparatorBuilder())
		}
	}
	await listsSend(guild, 2, container)
}

module.exports = { updateArchivesList }
