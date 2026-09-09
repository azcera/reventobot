const { Events, Client } = require('discord.js')
const {
	updateUnansweredList
} = require('../features/archive/archiveUnansweredList')
const { updateArchivesList } = require('../features/archive/archivesList')

require('dotenv').config()

/**
 * Обработчик создания веток
 * @param {Client} client
 */
module.exports = client => {
	client.on(Events.ThreadCreate, async thread => {
		if (thread.parentId === process.env.PARENT_CHANNEL_ID) {
			await updateArchivesList(thread.guild)
			await updateUnansweredList(thread.guild)
		}
	})
}
