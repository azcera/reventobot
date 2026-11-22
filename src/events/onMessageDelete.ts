import { Events, type Client, type Message, type PartialMessage } from 'discord.js'
import { store as dashboard } from '../dashboard/store'
import { scheduleArchiveListRefresh } from '../features/archive/updateLists'

export = (client: Client) => {
	const refresh = (message: Message | PartialMessage) => {
		if (
			message.inGuild() &&
			message.channel.isThread() &&
			message.channel.parentId === dashboard.getSetting('PARENT_CHANNEL_ID')
		) {
			scheduleArchiveListRefresh(message.guild, message.channelId)
		}
	}
	client.on(Events.MessageDelete, refresh)
	client.on(Events.MessageBulkDelete, messages => {
		const message = messages.first()
		if (message) refresh(message)
	})
}
