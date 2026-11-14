import { getError } from '../../utils/errors'
import { store as dashboard } from '../../dashboard/store'
import {
	Guild,
	ChannelType,
	MessageFlags,
	ContainerBuilder
} from 'discord.js'
import { getArchivesLists } from './archivesList'
import { getUnansweredList } from './archiveUnansweredList'
import { isMembershipMessage } from '../../services/familyMembership'
import { getUnusedArchiveLists } from './archiveCleanupInteractions'
require('dotenv').config()


/**
 * Отправляет или изменяет сообщение в панель управления
 * @param {Guild} guild
 */
const updates = new WeakMap<Guild, { pending: Promise<void>; rerun: boolean }>()

async function updateLists(guild: Guild) {
	const previous = updates.get(guild)
	if (previous) { previous.rerun = true; return previous.pending }
	const state = { pending: Promise.resolve(), rerun: false }
	updates.set(guild, state)
	state.pending = (async () => {
		try {
			do { state.rerun = false; await refreshLists(guild) } while (state.rerun)
		} finally { updates.delete(guild) }
	})()
	return state.pending
}

async function refreshLists(guild: Guild) {
	if (['PARENT_CHANNEL_ID', 'ARCHIVE_SETTINGS_CHANNEL', 'AUTO_ROLE', 'ARCHIVE_GROUP_ROLES'].some(key => !dashboard.getSetting(key).trim())) {
		console.warn('⚠️ Обновление списков архивов пропущено: заполните настройки архивов в дашборде.')
		return
	}
	/**
	 * @type {ContainerBuilder[]}
	 */
	const containers = [...await getUnusedArchiveLists(guild)]
	const allList = await getArchivesLists(guild)
	const unansweredList = await getUnansweredList(guild)

	if (allList && Array.isArray(allList.parts)) {
		containers.push(...allList.parts)
	}

	if (unansweredList) {
		containers.push(unansweredList)
	}

	if (containers.length < 1)
		return console.error('❌ Ошибка обновления архивных списков: списки пусты')

	const adminChannel =
		guild.channels.cache.get(dashboard.getSetting('ARCHIVE_SETTINGS_CHANNEL')) ||
		(await guild.channels.fetch(dashboard.getSetting('ARCHIVE_SETTINGS_CHANNEL')))

	if (
		!adminChannel ||
		(adminChannel && adminChannel.type != ChannelType.GuildText)
	) {
		return console.error(
			'❌ Канал архивных списков не настроен или отсутствует'
		)
	}

	const channelMessages: import('discord.js').Message[] = []
	let before: string | undefined
	for (;;) {
		const messages = await adminChannel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })
		channelMessages.push(...[...messages.values()].filter(message => message.author.id === guild.client.user.id && !isMembershipMessage(message)))
		if (messages.size < 100) break
		before = messages.last()!.id
	}
	channelMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp)

	if (channelMessages.length > containers.length) {
		for (let i = containers.length; i < channelMessages.length; i++) {
			await channelMessages[i].delete().catch(console.error)
		}
	}

	for (let index = 0; index < containers.length; index++) {
		const c = containers[index]

		const data = {
			components: [c],
			flags: MessageFlags.IsComponentsV2 as const
		}

		try {
			if (channelMessages.length >= index + 1) {
				await channelMessages[index].edit(data)
			} else {
				await adminChannel.send(data)
			}
		} catch (caught) {
 const error = getError(caught);
			console.error(
				`❌ Ошибка обновления/отправки сообщения на индексе ${index}:`,
				error
			)
		}
	}
}

export { updateLists }
