import { store as dashboard } from '../dashboard/store'
import { Events, Client } from 'discord.js'
import { updateLists } from '../features/archive/updateLists'

require('dotenv').config()

/**
 * Обработчик удаления веток
 * @param {Client} client
 */
export = (client: import('discord.js').Client) => {
	client.on(Events.ThreadDelete, async thread => {
		if (thread.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')) {
			await updateLists(thread.guild)
		}
	})
}
