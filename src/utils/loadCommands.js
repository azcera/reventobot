const fs = require('node:fs')
const path = require('node:path')

/**
 * Рекурсивно загружает все команды
 * @param {Client} client - Экземпляр Discord клиента
 * @param {string} directory - Путь к папке с командами
 */
function loadCommands(client, directory) {
	const files = fs.readdirSync(directory)

	for (const file of files) {
		const filePath = path.join(directory, file)
		const stat = fs.statSync(filePath)

		// Если это папка - заходим в нее рекурсивно
		if (stat.isDirectory()) {
			loadCommands(client, filePath)
		}
		// Если это JS-файл - пытаемся загрузить как команду
		else if (file.endsWith('.js')) {
			try {
				const command = require(filePath)

				// Поддержка префиксных команд (формат: !ping, !invite)
				if ('name' in command && 'execute' in command) {
					client.commands.set(command.name, command)
					console.log(`✅ Загружена команда: ${command.name}`)
				}
				// Поддержка Slash-команд (формат: /ping)
				else if ('data' in command && 'execute' in command) {
					client.commands.set(command.data.name, command)
					console.log(`✅ Загружена slash-команда: ${command.data.name}`)
				} else {
					console.warn(
						`⚠️ Файл ${file} пропущен: нет свойств 'name' или 'data' и 'execute'`
					)
				}
			} catch (error) {
				console.error(
					`❌ Ошибка загрузки команды из файла ${file}:`,
					error.message
				)
			}
		}
	}
}

module.exports = loadCommands
