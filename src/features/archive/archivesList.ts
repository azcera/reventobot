import { loadDiscordMembers } from '../../services/discordMembers'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	GuildMember,
	Guild,
	GuildChannel,
	TextDisplayBuilder,
	SeparatorBuilder
} from 'discord.js'
import { parseDisplayName } from '../../utils/parseDisplayName'

require('dotenv').config()





/**
 * Создает сообщение со списком всех участников и их архивов
 * @param {Guild} guild
 */
async function getArchivesLists(guild: import('discord.js').Guild) {
	if (!dashboard.roleIds('ARCHIVE_GROUP_ROLES').length || !dashboard.getSetting('AUTO_ROLE')) {
		console.error('❌ Не заданы ARCHIVE_GROUP_ROLES или AUTO_ROLE в настройках дашборда')
		return
	}

	await loadDiscordMembers(guild)

	/**
	 * @type {Object.<string, Array<{member: GuildMember, archiveChannel: GuildChannel|null, staticId: number, hasValidArchive: boolean, isInvalidNick: boolean}>>}
	 */
	const groupings: Record<string, { member: GuildMember; archiveChannel: import('discord.js').ThreadChannel | null; staticId: number; hasValidArchive: boolean; isInvalidNick: boolean }[]> = {}
	dashboard.roleIds('ARCHIVE_GROUP_ROLES').forEach(roleId => {
		groupings[roleId] = []
	})

	const filteredMembers = guild.members.cache.filter((member: import('discord.js').GuildMember) => {
		if (member.user.bot) return false
		if (!member.roles.cache.has(dashboard.getSetting('AUTO_ROLE'))) return false

		// Исключаем админов
		if (member.roles.cache.some(role => dashboard.roleIds('ADMIN_ROLES').includes(role.id))) {
			return false
		}

		return true
	})

	// Получаем все ветки из канала с архивами
	const parentChannel = await guild.channels.fetch(dashboard.getSetting('PARENT_CHANNEL_ID'))
	if (!parentChannel || !('threads' in parentChannel)) {
		console.error('❌ Не найден канал с архивами')
		return
	}

	const active = await parentChannel.threads.fetchActive()
	const archived = await parentChannel.threads.fetchArchived({ limit: 100 })

	const guildChannels = new Map([...active.threads, ...archived.threads])

	filteredMembers.forEach((member: import('discord.js').GuildMember) => {
		const sortedMemberRoles = member.roles.cache.sort(
			(a, b) => b.position - a.position
		)

		const highestMatchingRole = sortedMemberRoles.find(role =>
			dashboard.roleIds('ARCHIVE_GROUP_ROLES').includes(role.id)
		)

		if (!highestMatchingRole) return

		const parsedDisplayName = parseDisplayName(member.displayName)

		let archiveChannel = null
		let staticId = Infinity
		let hasValidArchive = false
		let isInvalidNick = !parsedDisplayName || !parsedDisplayName.memberName

		if (parsedDisplayName && !isInvalidNick) {
			archiveChannel =
				[...guildChannels.values()].find(
					ch =>
						ch.name ===
						[
							'archive',
							parsedDisplayName.memberName.toLowerCase(),
							parsedDisplayName.memberStatic
						].join(' ')
				) || null

			if (archiveChannel) {
				hasValidArchive = true
				const match = archiveChannel.name.match(/(\d+)\s*$/)
				staticId = match ? Number(match[1]) : Infinity
			} else if (parsedDisplayName.memberStatic) {
				staticId = Number(parsedDisplayName.memberStatic) || Infinity
			}
		}

		groupings[highestMatchingRole.id].push({
			member,
			archiveChannel,
			staticId,
			hasValidArchive,
			isInvalidNick
		})
	})

	const MAX_TOTAL_TEXT = 3800
	const title = dashboard.text('archives.1')
	const maxBlockLength = MAX_TOTAL_TEXT - title.length
	const blocks = []

	for (const key of Object.keys(groupings)) {
		if (!groupings[key].length) continue

		const role =
			guild.roles.cache.get(key) ||
			(await guild.roles.fetch(key).catch(() => null))

		if (!role) continue

		// Сортировка: сначала с валидным архивом по staticId, потом остальные
		const sortedItems = groupings[key].sort((a, b) => {
			if (a.hasValidArchive && b.hasValidArchive) {
				return a.staticId - b.staticId
			}
			if (a.hasValidArchive) return -1
			if (b.hasValidArchive) return 1
			return a.staticId - b.staticId
		})

		const sections = [
			{ title: 'Архивы', items: sortedItems.filter(item => !item.isInvalidNick && item.archiveChannel) },
			{ title: 'Нет архива', items: sortedItems.filter(item => !item.isInvalidNick && !item.archiveChannel) },
			{ title: 'Некорректный никнейм', items: sortedItems.filter(item => item.isInvalidNick) }
		]
		for (const section of sections) {
			if (!section.items.length) continue
			const heading = `## <@&${role.id}>\n### ${section.title}`
			let block = heading
			section.items.forEach((item, index) => {
				const line = `${index + 1}. <@${item.member.id}>` +
					(item.archiveChannel && !item.isInvalidNick ? ` → <#${item.archiveChannel.id}>` : '')
				if (block.length + 1 + line.length > maxBlockLength) {
					blocks.push(block)
					block = heading
				}
				block += `\n${line}`
			})
			blocks.push(block)
		}
	}

	// Собираем части
	const parts = []

	let currentContainer = new ContainerBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(title)
		)
		.addSeparatorComponents(new SeparatorBuilder())

	let currentLength = title.length

	for (const block of blocks) {
		if (currentLength + block.length > MAX_TOTAL_TEXT || currentContainer.components.length >= 36) {
			parts.push(currentContainer)

			currentContainer = new ContainerBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(title)
				)
				.addSeparatorComponents(new SeparatorBuilder())

			currentLength = title.length
		}

		currentContainer
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(block))
			.addSeparatorComponents(new SeparatorBuilder())

		currentLength += block.length
	}

	// Добавляем последнюю часть
	parts.push(currentContainer)

	return {
		parts: parts.map(container => dashboard.decorate('archives', container)),
		count: parts.length
	}
}

export { getArchivesLists }
