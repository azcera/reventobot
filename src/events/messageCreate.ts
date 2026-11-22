import { Events } from 'discord.js'
import { store as dashboard } from '../dashboard/store'
import { scheduleArchiveListRefresh } from '../features/archive/updateLists'
import { getError } from '../utils/errors'
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

		if (
			message.channel.isThread() &&
			message.channel.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')
		) {
			scheduleArchiveListRefresh(message.guild, message.channelId)
		}

		if (!message.author || message.author.bot) return

		// PREFIX
		if (!message.content.startsWith(PREFIX)) return

		const args = message.content.slice(PREFIX.length).trim().split(/\s+/)
		const commandName = args.shift()?.toLowerCase() || ''

		const command = client.commands.get(commandName)
		if (!command || !('name' in command)) return

		try {
			await command.execute(message, args)
		} catch (caught) {
			const error = getError(caught)
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
