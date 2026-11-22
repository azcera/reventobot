import { Client, Events } from 'discord.js'
import { store as dashboard } from '../dashboard/store'
import { updateLists } from '../features/archive/updateLists'
import { invalidateArchiveHistory, invalidateArchiveInventory } from '../features/archive/unusedArchives'
import { unlinkMemberArchive } from '../services/memberIdentity'

require('dotenv').config()

/**
 * Обработчик удаления веток
 * @param {Client} client
 */
export = (client: import('discord.js').Client) => {
	client.on(Events.ThreadDelete, async thread => {
		if (thread.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')) {
			invalidateArchiveInventory(thread.guild)
			invalidateArchiveHistory(thread.guild, thread.id)
			await unlinkMemberArchive(thread.guild.id, thread.id)
			await updateLists(thread.guild)
		}
	})
}
