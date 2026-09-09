const {
	GuildMember,
	Guild,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder
} = require('discord.js')
const { listsSend } = require('../../utils/listsSend')

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

	const groupings = {}
	rolesToGroup.forEach(roleId => {
		groupings[roleId] = []
	})

	const filteredMembers = guild.members.cache.filter(
		member => member.roles.cache.has(autoRoleId) && !member.user.bot
	)

	filteredMembers.forEach(member => {
		const sortedMemberRoles = member.roles.cache.sort(
			(a, b) => b.position - a.position
		)

		const highestMatchingRole = sortedMemberRoles.find(role =>
			rolesToGroup.includes(role.id)
		)

		let searchingChannel = guild.channels.cache.find(
			ch => ch.name === searchingChannelName
		)
		const archiveMember = {
			member
		}

		if (highestMatchingRole) {
			groupings[highestMatchingRole.id].push()
		}
	})

	const container = new ContainerBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('# 👥 Список участников и их архивов')
		)
		.addSeparatorComponents(new SeparatorBuilder())

	let stringList = 'Загрузка...'

	for (let key in Object.keys(groupings)) {
		const role = guild.roles.cache.get(key) || guild.roles.fetch(key)

		if (!role) return

		stringList = ''
		let index = 1

		for (let member in groupings[key]) {
			stringList += `${index}. <@${member.id}>\n`
		}
		container
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`## <@&${role.id}>:\n` + stringList)
			)
			.addSeparatorComponents(new SeparatorBuilder())

		await listsSend(guild, 2, container)
	}
}

module.exports = { updateArchivesList }
