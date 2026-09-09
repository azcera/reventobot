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
const ARCHIVE_PARENT_ID = '1542628698669453322'

let adminRoles = (process.env.ADMIN_ROLES || '')
	.split(',')
	.map(id => id.trim())
	.filter(Boolean)

adminRoles.push(process.env.TIER_CHECKER_ROLE_ID)

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
	 * @type {Object.<string, Array<{member: GuildMember, archiveChannel: GuildChannel|null, staticId: number, hasValidArchive: boolean}>>}
	 */
	const groupings = {}
	rolesToGroup.forEach(roleId => {
		groupings[roleId] = []
	})

	const filteredMembers = guild.members.cache.filter(member => {
		if (member.user.bot) return false
		if (!member.roles.cache.has(autoRoleId)) return false

		// Исключаем тех, у кого есть любая из ADMIN_ROLES
		const hasAdminRole = member.roles.cache.some(role =>
			adminRoles.includes(role.id)
		)
		if (hasAdminRole) return false

		return true
	})

	// Получаем все ветки из нужного канала
	const parentChannel = await guild.channels.fetch(ARCHIVE_PARENT_ID)
	if (!parentChannel || !parentChannel.threads) {
		console.error('❌ Не найден канал с архивами')
		return
	}

	const active = await parentChannel.threads.fetchActive()
	const archived = await parentChannel.threads.fetchArchived({ limit: 100 })

	const guildChannels = new Map([...active.threads, ...archived.threads])

	filteredMembers.forEach(member => {
		const sortedMemberRoles = member.roles.cache.sort(
			(a, b) => b.position - a.position
		)

		const highestMatchingRole = sortedMemberRoles.find(role =>
			rolesToGroup.includes(role.id)
		)

		if (!highestMatchingRole) return

		const parsedDisplayName = parseDisplayName(member.displayName)

		let archiveChannel = null
		let staticId = Infinity // чтобы те, у кого нет staticId, ушли вниз
		let hasValidArchive = false

		if (parsedDisplayName && parsedDisplayName.memberName) {
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
				// Достаём число в конце названия канала
				const match = archiveChannel.name.match(/(\d+)\s*$/)
				staticId = match ? Number(match[1]) : Infinity
			} else if (parsedDisplayName.memberStatic) {
				// Даже если канал не найден, пробуем взять static из ника
				staticId = Number(parsedDisplayName.memberStatic) || Infinity
			}
		}

		groupings[highestMatchingRole.id].push({
			member,
			archiveChannel,
			staticId,
			hasValidArchive,
			// для удобства вывода
			isInvalidNick: !parsedDisplayName || !parsedDisplayName.memberName
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

		// Сортировка:
		// 1. Сначала те, у кого есть валидный архив — по staticId (от меньшего к большему)
		// 2. Потом все остальные (нет архива / некорректный ник)
		const sortedItems = groupings[key].sort((a, b) => {
			if (a.hasValidArchive && b.hasValidArchive) {
				return a.staticId - b.staticId
			}
			if (a.hasValidArchive) return -1
			if (b.hasValidArchive) return 1
			return a.staticId - b.staticId
		})

		const lines = sortedItems.map((item, index) => {
			let channelText

			if (item.isInvalidNick) {
				channelText = '`некорректный никнейм`'
			} else if (item.archiveChannel) {
				channelText = `<#${item.archiveChannel.id}>`
			} else {
				channelText = 'нет архива'
			}

			return `${index + 1}. <@${item.member.id}> → ${channelText}`
		})

		const blockText = `## <@&${role.id}>\n${lines.join('\n')}`
		blocks.push(blockText)
	}

	// Разбиваем на несколько сообщений при необходимости
	let currentContainer = new ContainerBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('# 👥 Список участников и их архивов')
		)
		.addSeparatorComponents(new SeparatorBuilder())

	let currentLength = 60
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
