import { Events, type Client } from 'discord.js'
import { store } from '../dashboard/store'
import { deleteEmptyArchive } from '../features/archive/unusedArchives'
import { findArchiveByOwner } from '../features/archive/archiveSearch'
import { updateLists } from '../features/archive/updateLists'

export = (client: Client) => {
	client.on(Events.GuildMemberRemove, async member => {
		if (!store.ready || !store.getSetting('PARENT_CHANNEL_ID')) return
		try {
			if (store.getSetting('ARCHIVE_AUTO_DELETE_EMPTY')) {
				try {
					const thread = await findArchiveByOwner(member.guild, member.id)
					if (thread?.isThread()) await deleteEmptyArchive(thread, member.id)
				} catch (error) {
					console.error('[Archives] Ошибка автоудаления', member.id, error)
				}
			}
			await updateLists(member.guild)
		} catch (error) {
			console.error(
				'[Archives] Ошибка обработки выхода участника',
				(error as Error).message
			)
		}
	})
}
