import { getError } from './errors'
import { MessageFlags, type RepliableInteraction, type InteractionReplyOptions, type InteractionEditReplyOptions, type Message, type MessageReplyOptions } from 'discord.js'

/**
 * Отправляет эфемерное сообщение и автоматически удаляет его через указанное время
 * @param {Interaction} interaction - Discord interaction
 * @param {Object} options - Опции сообщения
 * @param {string} options.content - Текст сообщения
 * @param {Array} options.components - Компоненты (опционально)
 * @param {number} timeout - Время в миллисекундах (по умолчанию 60000 = 1 минута)
 */
async function sendEphemeralWithAutoDelete(
	interaction: import('discord.js').RepliableInteraction<'cached'>,
	options: InteractionReplyOptions,
	timeout: number = 60000
) {
	try {
		if (interaction.deferred) {
			const { flags: _flags, ...payload } = options
			return await editReplyWithAutoDelete(interaction, payload, timeout)
		}
		const response = await interaction.reply({
			...options,
			flags: MessageFlags.Ephemeral as const
		})

		setTimeout(async () => {
			try {
				if (interaction.replied) {
					await interaction.deleteReply().catch(() => {})
				}
			} catch (caught) {
 const err = getError(caught);
				// Сообщение уже удалено или истекло
			}
		}, timeout)

		return response
	} catch (caught) {
 const error = getError(caught);
		console.error('[AutoDelete] Ошибка отправки сообщения:', error)
	}
}

/**
 * Отправляет followUp эфемерное сообщение с авто удалением
 */
async function followUpEphemeralWithAutoDelete(
	interaction: RepliableInteraction,
	options: InteractionReplyOptions,
	timeout = 60000
) {
	try {
		const response = await interaction.followUp({
			...options,
			flags: MessageFlags.Ephemeral as const
		})

		setTimeout(async () => {
			try {
				if (response.deletable) {
					await response.delete().catch(() => {})
				}
			} catch (caught) {
 const err = getError(caught);
				// Сообщение уже удалено
			}
		}, timeout)

		return response
	} catch (caught) {
 const error = getError(caught);
		console.error('[AutoDelete] Ошибка followUp:', error)
	}
}

async function editReplyWithAutoDelete(interaction: RepliableInteraction, options: InteractionEditReplyOptions, timeout = 60000) {
	try {
		const response = await interaction.editReply(options)

		setTimeout(async () => {
			try {
				await interaction.deleteReply().catch(() => {})
			} catch (caught) {
 const err = getError(caught);
				// Сообщение уже удалено или недоступно
			}
		}, timeout)

		return response
	} catch (caught) {
 const error = getError(caught);
		console.error('[AutoDelete] Ошибка editReply:', error)
	}
}

/**
 * Удаляет обычное сообщение через указанное время.
 * @param {Message} message
 * @param {number} [timeout=5000]
 */
async function sendWithAutoDelete<T extends { delete(): Promise<unknown> }>(message: T, timeout: number = 5000) {
	setTimeout(() => {
		message.delete().catch(() => {})
	}, timeout)
	return message
}

/**
 * Отвечает на обычное сообщение и автоматически удаляет ответ.
 * @param {Message} originalMessage
 * @param {string|Object} content
 * @param {number} [timeout=5000]
 */
function replyWithAutoDelete(originalMessage: Message, content: string | MessageReplyOptions, timeout?: number): Promise<unknown>
function replyWithAutoDelete(originalMessage: RepliableInteraction, content: string | InteractionReplyOptions, timeout?: number): Promise<unknown>
async function replyWithAutoDelete(originalMessage: Message | RepliableInteraction, content: string | MessageReplyOptions | InteractionReplyOptions, timeout: number = 5000) {
	try {
		const payload = typeof content === 'string' ? { content } : content
		const reply = 'isRepliable' in originalMessage
			? await originalMessage.reply(payload as InteractionReplyOptions)
			: await originalMessage.reply(payload as MessageReplyOptions)
		return sendWithAutoDelete(reply, timeout)
	} catch (caught) {
 const error = getError(caught);
		console.error('[AutoDelete] Ошибка reply:', error)
	}
}

export {
	sendEphemeralWithAutoDelete,
	followUpEphemeralWithAutoDelete,
	editReplyWithAutoDelete,
	replyWithAutoDelete,
	sendWithAutoDelete
}
