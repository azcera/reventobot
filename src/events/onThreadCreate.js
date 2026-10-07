const { Events, Client } = require('discord.js')
const { updateLists } = require('../features/archive/updateLists')

require('dotenv').config()

/**
 * Обработчик создания веток
 * @param {Client} client
 */
module.exports = client => {
	client.on(Events.ThreadCreate, async thread => {
		if (thread.parentId === process.env.PARENT_CHANNEL_ID) {
			await updateLists(thread.guild)
		}
	})
}
