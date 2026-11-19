import { Client, Events } from 'discord.js'
import { store as dashboard } from '../dashboard/store'
import { updateLists } from '../features/archive/updateLists'

require('dotenv').config()

/**
 * Обработчик создания веток
 * @param {Client} client
 */
export = (client: import('discord.js').Client) => {
	client.on(Events.ThreadCreate, async thread => {
		if (thread.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')) {
			await updateLists(thread.guild)
		}
	})
}
