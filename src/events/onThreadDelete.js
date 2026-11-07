const { store: dashboard } = require('../dashboard/store')
const { Events, Client } = require('discord.js')
const { updateLists } = require('../features/archive/updateLists')

require('dotenv').config()

/**
 * Обработчик удаления веток
 * @param {Client} client
 */
module.exports = client => {
	client.on(Events.ThreadDelete, async thread => {
		if (thread.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')) {
			await updateLists(thread.guild)
		}
	})
}
