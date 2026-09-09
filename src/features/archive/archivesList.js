const {
	GuildMember,
	Guild,
	GuildChannel,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder
} = require('discord.js')
const { listsSend } = require('../../utils/listsSend')
const { parseDisplayName } = require('../../utils/parseDisplayName')

require('dotenv').config()

const rolesToGroup = (process.env.ARCHIVE_GROUP_ROLES || '')
	.split(',')
	.map(id => id.trim())
	.filter(Boolean)

const autoRoleId = process.env.AUTO_ROLE

/**
 * Обновляет сообщение со списком всех участников и их архивов
 * @param {Guild} guild
 */
async function updateArchivesList(guild) {
	if (!rolesToGroup.length || !autoRoleId) {
		console.error('❌ Не заданы ARCHIVE_GROUP_ROLES или AUTO_ROLE в .env')
		return
	}

	await guild.members.fetch()

	/**
	 * @type {Object.<string, Array<{member: GuildMember, archiveChannel: GuildChannel|null}>>}
	 */
	const groupings = {}
	rolesToGroup.forEach(roleId => {
		groupings[roleId] = []
	})

	const filteredMembers = guild.members.cache.filter(
		member => member.roles.cache.has(autoRoleId) && !member.user.bot
	)

	const ARCHIVE_PARENT_ID = '1542628698669453322'

	const parentChannel = await guild.channels.fetch(ARCHIVE_PARENT_ID)
	if (!parentChannel || !parentChannel.threads) {
		console.error('❌ Не найден канал с архивами')
		return
	}

	// Активные + архивные ветки
	const active = await parentChannel.threads.fetchActive()
	const archived = await parentChannel.threads.fetchArchived({ limit: 100 })

	// Если веток больше 100 — можно дописать пагинацию позже
	const guildChannels = new Map([...active.threads, ...archived.threads])

	console.log('Найдено веток:', guildChannels.size)
	console.log(
		'Примеры названий веток:',
		[...guildChannels.values()].slice(0, 5).map(t => t.name)
	)

	filteredMembers.forEach(member => {
		const sortedMemberRoles = member.roles.cache.sort(
			(a, b) => b.position - a.position
		)

		const highestMatchingRole = sortedMemberRoles.find(role =>
			rolesToGroup.includes(role.id)
		)

		if (!highestMatchingRole) return

		const parsedDisplayName = parseDisplayName(member.displayName)

		let archiveChannel = [...guildChannels.values()].find(
			ch =>
				ch.name ===
				[
					'archive',
					parsedDisplayName.memberName,
					parsedDisplayName.memberStatic
				].join(' ')
		)

		if (!archiveChannel) archiveChannel = null

		groupings[highestMatchingRole.id].push({
			member,
			archiveChannel
		})
	})

	const MAX_TOTAL_TEXT = 3800

	// Собираем блоки по ролям
	const blocks = []

	for (const key of Object.keys(groupings)) {
		if (!groupings[key].length) continue

		const role =
			guild.roles.cache.get(key) ||
			(await guild.roles.fetch(key).catch(() => null))

		if (!role) continue

		const lines = groupings[key].map((item, index) => {
			const channelText = item.archiveChannel
				? `<#${item.archiveChannel.id}>`
				: 'нет архива'

			return `${index + 1}. <@${item.member.id}> → ${channelText}`
		})

		const blockText = `## <@&${role.id}>\n${lines.join('\n')}`
		blocks.push(blockText)
	}

	// Разбиваем на несколько сообщений, если текст не влезает в 4000
	let currentContainer = new ContainerBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('# 👥 Список участников и их архивов')
		)
		.addSeparatorComponents(new SeparatorBuilder())

	let currentLength = 60 // примерно заголовок
	let messageIndex = 2

	const flush = async () => {
		await listsSend(guild, messageIndex, currentContainer)
		messageIndex++
		currentContainer = new ContainerBuilder()
		currentLength = 0
	}

	for (const block of blocks) {
		if (currentLength + block.length > MAX_TOTAL_TEXT) {
			await flush()
		}

		currentContainer
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(block))
			.addSeparatorComponents(new SeparatorBuilder())

		currentLength += block.length
	}

	// Отправляем последний контейнер
	if (currentLength > 0 || messageIndex === 2) {
		await listsSend(guild, messageIndex, currentContainer)
	}
}

module.exports = { updateArchivesList }
