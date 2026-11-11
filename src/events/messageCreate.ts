import { getError } from '../utils/errors'
import { store as dashboard } from '../dashboard/store'
import { Message, Events, Client, PermissionFlagsBits } from 'discord.js'
import { updateLists } from '../features/archive/updateLists'
require('dotenv').config()

const PREFIX = '!'

/**
 * Обработчик префиксных команд (!ping, !invite и т.д.).
 * Парсит args и вызывает command.execute(message, args).
 * @param {Client} client
 */
export = (client: import('discord.js').Client) => {
	client.on(Events.MessageCreate, async message => {
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

		// PREFIX
		if (!message.content.startsWith(PREFIX)) return

		const args = message.content.slice(PREFIX.length).trim().split(/\s+/)
		const commandName = args.shift()?.toLowerCase() || ''

		const command = client.commands.get(commandName)
		if (!command || !('name' in command)) return

		try {
			await command.execute(message, args)
		} catch (caught) {
 const error = getError(caught);
			console.error(
				`[Command Error] Ошибка выполнения префиксной команды !${commandName}:`,
				error
			)
			await message.channel
				.send('❌ Произошла ошибка при выполнении этой команды!')
				.catch(() => {})
		}
	})
}
