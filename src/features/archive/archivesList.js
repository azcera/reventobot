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

		let stringList = ''
		let index = 1

		for (const item of groupings[key]) {
			const channelText = item.archiveChannel
				? `<#${item.archiveChannel.id}>`
				: 'нет архива'

			stringList += `${index}. <@${item.member.id}> -----> ${channelText}\n`
			index++
		}

		container
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## <@&${role.id}>:\n` + stringList)
			)
			.addSeparatorComponents(new SeparatorBuilder())
	}
	await listsSend(guild, 2, container)
}

module.exports = { updateArchivesList }
