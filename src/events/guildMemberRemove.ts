import { Events, type Client } from 'discord.js'
import { store } from '../dashboard/store'
import { deleteEmptyArchive, fetchArchiveThreads } from '../features/archive/unusedArchives'
import { updateLists } from '../features/archive/updateLists'

export = (client: Client) => {
	client.on(Events.GuildMemberRemove, async member => {
		if (!store.ready || !store.getSetting('PARENT_CHANNEL_ID')) return
		try {
			if (store.getSetting('ARCHIVE_AUTO_DELETE_EMPTY')) {
				for (const thread of (await fetchArchiveThreads(member.guild)).values()) {
					if (!store.getSetting('ARCHIVE_AUTO_DELETE_EMPTY')) break
					try { await deleteEmptyArchive(thread, member.id) }
					catch (error) { console.error('[Archives] Ошибка автоудаления', thread.id, (error as Error).message) }
				}
			}
			await updateLists(member.guild)
		} catch (error) { console.error('[Archives] Ошибка обработки выхода участника', (error as Error).message) }
	})
}
