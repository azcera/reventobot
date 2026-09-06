const { MessageFlags } = require('discord.js')
const { getNavigationContainer } = require('./navigationBuilder')
require('dotenv').config()

/**
 * Команда !navigation.
 * Удаляет сообщение-команду и отправляет готовый контейнер навигации.
 */
module.exports = {
	name: 'navigation',
	description: 'Создает навигацию',
	async execute(message, args) {
		await message
			.delete()
			.catch(err => console.log('Не удалось удалить сообщение:', err))

		return await message.channel.send({
			flags: [MessageFlags.IsComponentsV2],
			components: [getNavigationContainer(null, false)]
		})
	}
}
