import { ChannelType, Events, type Client } from 'discord.js'
import { store } from '../dashboard/store'
import { onArchiveMembershipChange, scheduleArchiveAccess } from '../features/archive/archiveAccess'
import { scheduleArchiveListRefresh } from '../features/archive/updateLists'
import { saveMemberStatic } from '../services/memberIdentity'
import { parseDisplayName } from '../utils/parseDisplayName'

export = (client: Client) => {
	client.on(Events.GuildMemberAdd, member => {
		if (process.env.GUILD_ID && process.env.GUILD_ID !== member.guild.id) return
		scheduleArchiveAccess(member.guild)
		if (!store.ready || member.user.bot) return
		if (store.getSetting('PARENT_CHANNEL_ID')) scheduleArchiveListRefresh(member.guild)
		const parsed = parseDisplayName(member.displayName)
		if (parsed) void saveMemberStatic(member.guild.id, member.id, parsed.memberStatic)
			.catch(error => console.error('[Archive registry]', error))
	})
	client.on(Events.GuildMemberRemove, member => scheduleArchiveAccess(member.guild))
	client.on(Events.GuildMemberUpdate, (before, after) => {
		if (before.partial || !before.roles.cache.equals(after.roles.cache)) scheduleArchiveAccess(after.guild)
	})
	client.on(Events.GuildRoleUpdate, (before, after) => {
		if (before.permissions.bitfield !== after.permissions.bitfield) scheduleArchiveAccess(after.guild)
	})
	client.on(Events.GuildRoleDelete, role => scheduleArchiveAccess(role.guild))
	client.on(Events.ChannelUpdate, (_, channel) => {
		if ('guild' in channel && channel.id === store.getSetting('PARENT_CHANNEL_ID')) scheduleArchiveAccess(channel.guild)
	})
	client.on(Events.ThreadMembersUpdate, (added, removed, thread) => {
		if (thread.parentId === store.getSetting('PARENT_CHANNEL_ID'))
			onArchiveMembershipChange(thread, added.keys(), removed.keys())
	})
	client.on(Events.ThreadUpdate, (before, thread) => {
		if (thread.parentId === store.getSetting('PARENT_CHANNEL_ID') &&
			thread.type === ChannelType.PrivateThread && thread.invitable &&
			before.type === ChannelType.PrivateThread && !before.invitable) scheduleArchiveAccess(thread.guild)
	})
}
