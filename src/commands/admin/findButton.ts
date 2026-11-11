import { replyWithAutoDelete } from '../../utils/autoDelete'
import { getError } from '../../utils/errors'
import {
	MessageFlags,
	ButtonInteraction,
	Message,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	ContainerBuilder,
	PermissionFlagsBits
} from 'discord.js'
import { getNavigationContainer } from './navigationBuilder'
require('dotenv').config()

/**
 * Команда !find.
 * Удаляет сообщение-команду и отправляет готовый контейнер навигации.
 */
export = {
	name: 'find',
	description: 'Добавляет кнопку к сообщению',
	/**
	 * Команда !navigation.
	 * @param {Message} message
	 * @param {string} args
	 */
	async execute(message: import('discord.js').Message<true>, args: string[]) {
		if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return await replyWithAutoDelete(
				message,
				'У вас нет прав для использования этой команды!'
			)
		}

		const archiveChannel = message.guild.channels.cache.find(ch =>
			ch.name.includes('архивы')
		)

		if (!archiveChannel || !archiveChannel.isTextBased()) {
			return console.log('Канал не найден или в него нельзя писать')
		}

		try {
			const lastMessage = (
				await archiveChannel.messages.fetch({ limit: 1 })
			).first()

			if (!lastMessage) {
				return console.log('В канале нет сообщений')
			}

			const searchButton = new ButtonBuilder()
				.setCustomId('archive_find')
				.setLabel('🔎 НАЙТИ АРХИВ')
				.setStyle(ButtonStyle.Primary)

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(searchButton)

			await lastMessage.edit({
				components: [...lastMessage.components, row],
				flags: MessageFlags.IsComponentsV2 as const
			})
		} catch (caught) {
 const error = getError(caught);
			console.error('Ошибка при работе с сообщением:', error)
		}
	}
}
