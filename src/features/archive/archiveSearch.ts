import { getError } from '../../utils/errors'
import { Client, ButtonInteraction, MessageFlags } from 'discord.js'
import { parseDisplayName } from '../../utils/parseDisplayName'
import { store as dashboard } from '../../dashboard/store'

async function findMemberArchive(guild: import('discord.js').Guild, parsed: NonNullable<ReturnType<typeof parseDisplayName>>, signal?: AbortSignal) {
	const parentId = dashboard.getSetting('PARENT_CHANNEL_ID')
	const name = ['archive', parsed.memberName.toLowerCase(), parsed.memberStatic].join(' ')
	const matches = (channel: import('discord.js').GuildBasedChannel | null) => !!channel?.isThread() && channel.parentId === parentId && channel.name === name
	const cached = guild.channels.cache.find(matches)
	if (cached) return cached
	const parent = guild.channels.cache.get(parentId) || await guild.channels.fetch(parentId)
	signal?.throwIfAborted()
	if (!parent || !('threads' in parent)) throw new Error('Родительский канал архивов не настроен.')
	const active = await parent.threads.fetchActive()
	signal?.throwIfAborted()
	const found = active.threads.find(matches)
	if (found) return found
	let before
	do {
		const page = await parent.threads.fetchArchived({ type: 'private', fetchAll: true, limit: 100, before })
		signal?.throwIfAborted()
		const archived = page.threads.find(matches)
		if (archived) return archived
		if (!page.hasMore) return null
		const next = Math.min(...page.threads.map(thread => thread.archiveTimestamp ?? Infinity))
		if (!Number.isFinite(next) || (before !== undefined && next >= before)) {
			throw new Error('Не удалось продолжить поиск архивов.')
		}
		before = next
	} while (true)
}

/**
 * Ищет канал-архив для пользователя, нажавшего кнопку archive_find
 * @param {ButtonInteraction} interaction
 */
async function findArchive(interaction: import('discord.js').ButtonInteraction<'cached'>) {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral as const })
	let timeout: ReturnType<typeof setTimeout> | undefined
	const controller = new AbortController()

	try {
		const member = interaction.member
		const guild = interaction.guild

		const parsed = parseDisplayName(member.displayName)

		if (!parsed) {
			return await interaction.editReply({
				content: `❌ Не удалось найти архив: ваш никнейм на сервере имеет неверный формат.`
			})
		}

		const searchingChannel = await Promise.race([
			findMemberArchive(guild, parsed, controller.signal),
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
 const err = getError(caught);
		console.error('❌ Ошибка при поиске архива: ', err)
		try {
			await interaction.editReply({
				content: err.message === 'ARCHIVE_SEARCH_TIMEOUT'
					? '❌ Discord слишком долго отвечает на поиск архива. Повторите попытку.'
					: '❌ Произошла внутренняя ошибка при поиске архива.'
			})
		} catch (_) {}
	} finally { clearTimeout(timeout) }
}

export { findArchive, findMemberArchive }
