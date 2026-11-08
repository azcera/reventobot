const { Client, ButtonInteraction, MessageFlags } = require('discord.js')
const { parseDisplayName } = require('../../utils/parseDisplayName')
const { store: dashboard } = require('../../dashboard/store')

async function findMemberArchive(guild, parsed) {
	const parentId = dashboard.getSetting('PARENT_CHANNEL_ID')
	const name = ['archive', parsed.memberName.toLowerCase(), parsed.memberStatic].join(' ')
	const matches = channel => channel?.isThread() && channel.parentId === parentId && channel.name === name
	const cached = guild.channels.cache.find(matches)
	if (cached) return cached
	const parent = guild.channels.cache.get(parentId) || await guild.channels.fetch(parentId)
	if (!parent?.threads) throw new Error('Родительский канал архивов не настроен.')
	const active = await parent.threads.fetchActive()
	const found = active.threads.find(matches)
	if (found) return found
	let before
	do {
		const page = await parent.threads.fetchArchived({ type: 'private', fetchAll: true, limit: 100, before })
		const archived = page.threads.find(matches)
		if (archived) return archived
		if (!page.hasMore) return null
		const next = Math.min(...page.threads.map(thread => thread.archiveTimestamp))
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
async function findArchive(interaction) {
	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

	try {
		const member = interaction.member
		const guild = interaction.guild

		const parsed = parseDisplayName(member.displayName)

		if (!parsed) {
			return await interaction.editReply({
				content: `❌ Не удалось найти архив: ваш никнейм на сервере имеет неверный формат.`
			})
		}

		const searchingChannel = await findMemberArchive(guild, parsed)

		if (searchingChannel) {
			return await interaction.editReply({
				content: `Ваш архив - <#${searchingChannel.id}>`
			})
		} else {
			return await interaction.editReply({
				content: `❌ Для вас нет созданного архива.`
			})
		}
	} catch (err) {
		console.error('❌ Ошибка при поиске архива: ', err)
		try {
			await interaction.editReply({
				content: '❌ Произошла внутренняя ошибка при поиске архива.'
			})
		} catch (_) {}
	}
}

module.exports = { findArchive, findMemberArchive }
