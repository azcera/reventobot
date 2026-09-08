const { Events, Client } = require('discord.js')
const {
	updateUnansweredList
} = require('../features/archive/archiveUnansweredList')

require('dotenv').config()

/**
 * Обработчик удаления веток
 * @param {Client} client
 */
module.exports = client => {
	client.on(Events.ThreadDelete, async thread => {
		if (thread.parentId === process.env.PARENT_CHANNEL_ID) {
			await updateUnansweredList(thread.guild)
		}
	})
}
