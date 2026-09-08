const { Message, Events, Client, PermissionFlagsBits } = require('discord.js')
const {
	updateUnansweredList
} = require('../features/archive/archiveUnansweredList')

require('dotenv').config()

const ADMIN_ROLES = process.env.ADMIN_ROLES
const PARENT_CHANNEL_ID = process.env.PARENT_CHANNEL_ID

/**
 * Обработчик удаления сообщений
 * @param {Client} client
 */
module.exports = client => {
	client.on(Events.MessageDelete, async message => {
		if (message.author.bot) return

		if (
			message.channel.isThread() &&
			message.channel.parentId === PARENT_CHANNEL_ID
		) {
			const member =
				message.member ||
				(await message.guild?.members
					.fetch(message.author.id)
					.catch(() => null))

			const authorHasAdminRole =
				member.permissions.has(PermissionFlagsBits.Administrator) ||
				member.roles.cache.some(role => ADMIN_ROLES.includes(role.id))

			const messageHasUserMention = message.mentions.users.size > 0
			const messageHasRoleMention = message.mentions.roles.size > 0
			const messageHasEveryone = message.mentions.everyone

			const hasAnyMention =
				messageHasUserMention || messageHasRoleMention || messageHasEveryone

			if ((!message.author.bot && hasAnyMention) || !authorHasAdminRole) {
				await updateUnansweredList(message.guild)
			}
		}
	})
}
