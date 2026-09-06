require('dotenv').config()

const PREFIX = '!'

/**
 * Обработчик префиксных команд (!ping, !invite и т.д.).
 * Парсит args и вызывает command.execute(message, args).
 * @param {Client} client
 */
module.exports = client => {
	client.on('messageCreate', async message => {
		if (message.author.bot) return
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
