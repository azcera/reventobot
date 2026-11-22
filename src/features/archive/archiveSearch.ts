import { ButtonInteraction, MessageFlags, RESTJSONErrorCodes, type Guild } from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { getMemberIdentity, unlinkMemberArchive } from '../../services/memberIdentity'
import { getError } from '../../utils/errors'
import { getArchiveOwners, getArchiveThreads } from './unusedArchives'

async function getRegisteredArchive(guild: Guild, threadId: string) {
	const channel = guild.channels.cache.get(threadId) ?? await guild.channels.fetch(threadId).catch(error => {
		if (Number(getError(error).code) === RESTJSONErrorCodes.UnknownChannel) return null
		throw error
	})
	if (!channel) return null
	if (!channel.isThread() || channel.parentId !== dashboard.getSetting('PARENT_CHANNEL_ID'))
		throw new Error('Привязанный архив находится вне настроенного канала.')
	return channel
}

async function findArchiveByOwner(guild: Guild, userId: string, signal?: AbortSignal) {
	const record = await getMemberIdentity(guild.id, userId)
	signal?.throwIfAborted()
	if (record?.archive_thread_id) {
		const thread = await getRegisteredArchive(guild, record.archive_thread_id)
		signal?.throwIfAborted()
		if (thread) return thread
		await unlinkMemberArchive(guild.id, record.archive_thread_id)
	}
	const threads = await getArchiveThreads(guild)
	signal?.throwIfAborted()
	const owners = await getArchiveOwners(guild, threads)
	signal?.throwIfAborted()
	return threads.find(thread => owners.get(thread.id) === userId) ?? null
}

/**
 * Ищет канал-архив для пользователя, нажавшего кнопку archive_find
 * @param {ButtonInteraction} interaction
 */
async function findArchive(
	interaction: import('discord.js').ButtonInteraction<'cached'>
) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral as const })
	let timeout: ReturnType<typeof setTimeout> | undefined
	const controller = new AbortController()

	try {
		const member = interaction.member
		const guild = interaction.guild

		const searchingChannel = await Promise.race([
			findArchiveByOwner(guild, member.id, controller.signal),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => {
					controller.abort()
					reject(new Error('ARCHIVE_SEARCH_TIMEOUT'))
				}, 20000)
			})
		])

		if (searchingChannel) {
			return await interaction.editReply({
				content: `Ваш архив - <#${searchingChannel.id}>`
			})
		} else {
			return await interaction.editReply({
				content: `❌ Для вас нет созданного архива.`
			})
		}
	} catch (caught) {
		const err = getError(caught)
		console.error('❌ Ошибка при поиске архива: ', err)
		try {
			await interaction.editReply({
				content:
					err.message === 'ARCHIVE_SEARCH_TIMEOUT'
						? '❌ Discord слишком долго отвечает на поиск архива. Повторите попытку.'
						: '❌ Произошла внутренняя ошибка при поиске архива.'
			})
		} catch (_) {}
	} finally {
		clearTimeout(timeout)
	}
}

export { findArchive, findArchiveByOwner, getRegisteredArchive }
