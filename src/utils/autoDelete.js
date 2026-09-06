const { MessageFlags } = require('discord.js')

/**
 * Отправляет эфемерное сообщение и автоматически удаляет его через указанное время
 * @param {Interaction} interaction - Discord interaction
 * @param {Object} options - Опции сообщения
 * @param {string} options.content - Текст сообщения
 * @param {Array} options.components - Компоненты (опционально)
 * @param {number} timeout - Время в миллисекундах (по умолчанию 60000 = 1 минута)
 */
async function sendEphemeralWithAutoDelete(
	interaction,
	options,
	timeout = 60000
) {
	try {
		const response = await interaction.reply({
			...options,
			flags: [MessageFlags.Ephemeral]
		})

		setTimeout(async () => {
			try {
				if (interaction.replied) {
					await interaction.deleteReply().catch(() => {})
				}
			} catch (err) {
				// Сообщение уже удалено или истекло
			}
		}, timeout)

		return response
	} catch (error) {
		console.error('[AutoDelete] Ошибка отправки сообщения:', error)
	}
}

/**
 * Отправляет followUp эфемерное сообщение с авто удалением
 */
async function followUpEphemeralWithAutoDelete(
	interaction,
	options,
	timeout = 60000
) {
	try {
		const response = await interaction.followUp({
			...options,
			flags: [MessageFlags.Ephemeral]
		})

		setTimeout(async () => {
			try {
				if (response.deletable) {
					await response.delete().catch(() => {})
				}
			} catch (err) {
				// Сообщение уже удалено
			}
		}, timeout)

		return response
	} catch (error) {
		console.error('[AutoDelete] Ошибка followUp:', error)
	}
}

async function editReplyWithAutoDelete(interaction, options, timeout = 60000) {
	try {
		const response = await interaction.editReply(options)

		setTimeout(async () => {
			try {
				await interaction.deleteReply().catch(() => {})
			} catch (err) {
				// Сообщение уже удалено или недоступно
			}
		}, timeout)

		return response
	} catch (error) {
		console.error('[AutoDelete] Ошибка editReply:', error)
	}
}

/**
 * Удаляет обычное сообщение через указанное время.
 * @param {Message} message
 * @param {number} [timeout=5000]
 */
async function sendWithAutoDelete(message, timeout = 5000) {
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
async function replyWithAutoDelete(originalMessage, content, timeout = 5000) {
	try {
		const reply = await originalMessage.reply(content)
		return sendWithAutoDelete(reply, timeout)
	} catch (error) {
		console.error('[AutoDelete] Ошибка reply:', error)
	}
}

module.exports = {
	sendEphemeralWithAutoDelete,
	followUpEphemeralWithAutoDelete,
	editReplyWithAutoDelete,
	replyWithAutoDelete,
	sendWithAutoDelete
}
