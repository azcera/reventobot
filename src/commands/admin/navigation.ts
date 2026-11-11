import { MessageFlags } from 'discord.js'
import { getNavigationContainer } from './navigationBuilder'
require('dotenv').config()

/**
 * Команда !navigation.
 * Удаляет сообщение-команду и отправляет готовый контейнер навигации.
 */
export = {
	name: 'navigation',
	description: 'Создает навигацию',
	async execute(message: import('discord.js').Message<true>, args: string[]) {
		await message
			.delete()
			.catch(err => console.log('Не удалось удалить сообщение:', err))

		const sent = await message.channel.send({
			flags: MessageFlags.IsComponentsV2 as const,
			components: [getNavigationContainer(null, false)]
		})
		await (require('../../dashboard/navigationMessages') as typeof import('../../dashboard/navigationMessages')).rememberSent(sent)
		return sent
	}
}
