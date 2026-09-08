const { Message, Events, Client, PermissionFlagsBits } = require('discord.js')
const {
	updateUnansweredList
} = require('../features/archive/archiveUnansweredList')

require('dotenv').config()

const PREFIX = '!'
const ADMIN_ROLES = process.env.ADMIN_ROLES
const PARENT_CHANNEL_ID = process.env.PARENT_CHANNEL_ID

/**
 * Обработчик префиксных команд (!ping, !invite и т.д.).
 * Парсит args и вызывает command.execute(message, args).
 * @param {Client} client
 */
module.exports = client => {
	client.on(Events.MessageCreate, async message => {
		if (message.author.bot) return

		if (message.channel.isThread()) {
			const thread = message.channel

			if (thread.parentId === PARENT_CHANNEL_ID) {
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
		}

		// PREFIX
		if (!message.content.startsWith(PREFIX)) return

		const args = message.content.slice(PREFIX.length).trim().split(/\s+/)
		const commandName = args.shift().toLowerCase()

		const command = client.commands.get(commandName)
		if (!command) return

		try {
			await command.execute(message, args)
		} catch (error) {
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
