import { store as dashboard } from '../dashboard/store'
import { Message, Events, Client, PermissionFlagsBits } from 'discord.js'
import { updateLists } from '../features/archive/updateLists'

require('dotenv').config()


/**
 * Обработчик удаления сообщений
 * @param {Client} client
 */
export = (client: import('discord.js').Client) => {
	client.on(Events.MessageDelete, async message => {
 if (!message.inGuild()) return
		if (!message.author || message.author.bot) return

		if (
			message.channel.isThread() &&
			message.channel.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')
		) {
			const member =
				message.member ||
				(await message.guild?.members
					.fetch(message.author.id)
					.catch(() => null))

			const authorHasAdminRole =
				member?.permissions.has(PermissionFlagsBits.Administrator) ||
				member?.roles.cache.some(role => dashboard.roleIds('ADMIN_ROLES').includes(role.id))

			const messageHasUserMention = message.mentions.users.size > 0
			const messageHasRoleMention = message.mentions.roles.size > 0
			const messageHasEveryone = message.mentions.everyone

			const hasAnyMention =
				messageHasUserMention || messageHasRoleMention || messageHasEveryone

			if ((!message.author.bot && hasAnyMention) || !authorHasAdminRole) {
				await updateLists(message.guild)
			}
		}
	})
}
