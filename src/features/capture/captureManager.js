const { store: dashboard } = require('../../dashboard/store')
const {
	MessageFlags,
	ActionRowBuilder,
	TextDisplayBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	SeparatorBuilder,
	StringSelectMenuBuilder,
	PermissionFlagsBits,
	ChannelType
} = require('discord.js')
const { createHash } = require('node:crypto')
require('dotenv').config()

const pool = require('../../services/database.js')

const APPROVAL_PAGE_SIZE = 50

function joinedPlayers(mainList, reserveList, mainMeta, reserveMeta) {
	return [...mainList, ...reserveList]
		.map((userId, index) => {
			const meta =
				index < mainList.length
					? mainMeta[index]
					: reserveMeta[index - mainList.length]
			return { userId, joinedAt: meta?.joinedAt ?? index }
		})
		.sort((a, b) => a.joinedAt - b.joinedAt)
}

function redistributeApproved(
	mainList,
	reserveList,
	mainMeta,
	reserveMeta,
	approved,
	maxMain
) {
	const selected = new Set(approved)
	const players = joinedPlayers(mainList, reserveList, mainMeta, reserveMeta)
	const main = approved.length
		? players.filter(player => selected.has(player.userId))
		: players.slice(0, maxMain)
	const reserve = approved.length
		? players.filter(player => !selected.has(player.userId))
		: players.slice(maxMain)
	return {
		mainList: main.map(p => p.userId),
		reserveList: reserve.map(p => p.userId),
		mainMeta: main,
		reserveMeta: reserve
	}
}

function approvalGroups(
	mainList,
	reserveList,
	page,
	mainMeta = [],
	reserveMeta = [],
	guild,
	sortMode = 'priority'
) {
	const joined = joinedPlayers(mainList, reserveList, mainMeta, reserveMeta)
	const ordered = guild && sortMode !== 'time'
		? sortByRolePriority(joined, guild)
		: joined.map(player => player.userId)
	const players = ordered.slice(page * APPROVAL_PAGE_SIZE, (page + 1) * APPROVAL_PAGE_SIZE)
	const groups = []
	for (let i = 0; i < players.length; i += 25)
		groups.push(players.slice(i, i + 25))
	return groups
}

function approvalId(group) {
	return (
		'capt_approve_' +
		createHash('sha256').update(group.join(',')).digest('hex').slice(0, 20)
	)
}

// Parse PRIORITY_ROLES from env: comma-separated role IDs, highest priority first

/**
 * Gets the priority index for a member based on their highest role.
 * Returns index in PRIORITY_ROLES array, or PRIORITY_ROLES.length if no match.
 * @param {GuildMember} member
 * @returns {number}
 */
function getRolePriority(member) {
	for (let i = 0; i < dashboard.roleIds('PRIORITY_ROLES').length; i++) {
		if (member.roles.cache.has(dashboard.roleIds('PRIORITY_ROLES')[i])) return i
	}
	return dashboard.roleIds('PRIORITY_ROLES').length // lowest priority (after all configured roles)
}

/**
 * Sorts a list of user objects by role priority, then by join timestamp.
 * Each item: { userId, joinedAt }
 * @param {Array<{userId: string, joinedAt: number}>} list
 * @param {Guild} guild
 * @returns {Array<string>} sorted userIds
 */
function sortByRolePriority(list, guild) {
	return [...list]
		.sort((a, b) => {
			const memberA = guild.members.cache.get(a.userId)
			const memberB = guild.members.cache.get(b.userId)

			const priorityA = memberA
				? getRolePriority(memberA)
				: dashboard.roleIds('PRIORITY_ROLES').length
			const priorityB = memberB
				? getRolePriority(memberB)
				: dashboard.roleIds('PRIORITY_ROLES').length

			if (priorityA !== priorityB) return priorityA - priorityB

			// Same priority: earlier join timestamp comes first
			return a.joinedAt - b.joinedAt
		})
		.map(item => item.userId)
}

function buildCaptureMessage(
	discordTimestamp,
	mainList,
	reserveList,
	leftList,
	target,
	maxMain,
	guild,
	mainListMeta = [],
	reserveListMeta = [],
	approvedUsers = [],
	approvalPage = 0,
	sortMode = 'priority'
) {
	const approved = new Set(approvedUsers)
	approvalPage = Math.max(
		0,
		Math.min(
			approvalPage,
			Math.max(
				0,
				Math.ceil((mainList.length + reserveList.length) / APPROVAL_PAGE_SIZE) -
					1
			)
		)
	)
	const title = new TextDisplayBuilder().setContent(
		dashboard.text('capture.title', { target: target ?? 'капт' })
	)
	const time = new TextDisplayBuilder().setContent(
		dashboard.text('capture.time', { time: discordTimestamp })
	)

	const helpText = new TextDisplayBuilder().setContent(dashboard.text('capture.1'))

	const players = joinedPlayers(mainList, reserveList, mainListMeta, reserveListMeta)
	const byTime = players.map(player => player.userId)
	const byPriority = guild ? sortByRolePriority(players, guild) : byTime
	const timeMode = sortMode === 'time'
	const currentOrder = timeMode ? byTime : byPriority
	const otherRanks = new Map(
		(timeMode ? byPriority : byTime).map((id, index) => [id, index + 1])
	)
	const start = approvalPage * APPROVAL_PAGE_SIZE
	const playersText = currentOrder.slice(start, start + APPROVAL_PAGE_SIZE)
		.map((id, index) =>
			`${start + index + 1}. <@${id}> — ${timeMode ? 'приоритет' : 'запись'} №${otherRanks.get(id)}${approved.has(id) ? ' ✅' : ''}`
		).join('\n') || 'Пусто'
	const leftPlayersText =
		leftList.length > 0
			? leftList.map((id, index) => `• <@${id}>`).join('\n')
			: 'Пусто'

	const queueTitle = new TextDisplayBuilder().setContent(
		dashboard.text('capture.queue', {
			count: players.length,
			approved: approved.size,
			limit: maxMain,
			mode: timeMode ? 'по времени записи' : 'по роли и времени записи',
			page: approvalPage + 1,
			pages: Math.max(1, Math.ceil(players.length / APPROVAL_PAGE_SIZE)),
			players: playersText
		})
	)
	const leftTitle = new TextDisplayBuilder().setContent(
		dashboard.text('capture.left', { count: leftList.length, players: leftPlayersText })
	)

	const containerComponent = new ContainerBuilder()

	containerComponent.addTextDisplayComponents(title, time, helpText)

	containerComponent
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(queueTitle)
		.addActionRowComponents(new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId('capt_sort_toggle')
				.setLabel(timeMode ? 'Сортировать по приоритету' : 'Сортировать по времени')
				.setStyle(ButtonStyle.Secondary)
		))

	if (leftList.length > 0) {
		containerComponent
			.addSeparatorComponents(new SeparatorBuilder())
			.addTextDisplayComponents(leftTitle)
	}

	// Кнопки управления для участников и админов
	const buttonsRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('capt_join')
			.setLabel(dashboard.text('capture.2'))
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId('capt_leave')
			.setLabel(dashboard.text('capture.3'))
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('capt_edit_time_trigger') // Название кнопки для перехвата админ права
			.setLabel(dashboard.text('capture.4'))
			.setStyle(ButtonStyle.Secondary)
	)
	const pageCount = Math.ceil(
		(mainList.length + reserveList.length) / APPROVAL_PAGE_SIZE
	)
	if (pageCount > 1)
		buttonsRow.addComponents(
			new ButtonBuilder()
				.setCustomId(`capt_approval_page_${approvalPage - 1}`)
				.setLabel(dashboard.text('capture.5'))
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(approvalPage === 0),
			new ButtonBuilder()
				.setCustomId(`capt_approval_page_${approvalPage + 1}`)
				.setLabel(dashboard.text('capture.6'))
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(approvalPage >= pageCount - 1)
		)
	const menus = approvalGroups(
		mainList,
		reserveList,
		approvalPage,
		mainListMeta,
		reserveListMeta,
		guild,
		sortMode
	).map((group, index) => {
		const start = approvalPage * APPROVAL_PAGE_SIZE + index * 25 + 1
		const menu = new StringSelectMenuBuilder()
			.setCustomId(approvalId(group))
			.setPlaceholder(
				`Одобрить участников ${start}–${start + group.length - 1}`
			)
			.setMinValues(0)
			.setMaxValues(group.length)
			.addOptions(
				group.map((id, index) => ({
					label: `${start + index}. ${guild?.members.cache.get(id)?.displayName || id}`.slice(
						0,
						100
					),
					value: id,
					default: approved.has(id)
				}))
			)
		return new ActionRowBuilder().addComponents(menu)
	})

	return {
		flags: MessageFlags.IsComponentsV2,
		components: [dashboard.decorate('capture', containerComponent), buttonsRow, ...menus]
	}
}

/**
 * Обновляет время в сообщении набора после редактирования
 * @param {string} messageId - ID сообщения в канале
 * @param {string} channelId - ID канала, где находится сообщение
 * @param {string} newTimestamp - Новый Discord timestamp
 * @param {Client} client - Discord клиент для поиска сообщения
 */
async function updateCollectionTime(
	messageId,
	channelId,
	newTimestamp,
	client
) {
	console.log(
		`[UpdateTime] Начало обновления: messageId=${messageId}, channelId=${channelId}`
	)

	if (!messageId || !channelId || !client) {
		console.error('[UpdateTime] Недостающие параметры:', {
			messageId,
			channelId,
			hasClient: !!client
		})
		return
	}

	const result = await pool.query(
		'SELECT * FROM active_captures WHERE message_id = $1',
		[messageId]
	)

	if (result.rows.length === 0) {
		console.error('[UpdateTime] Набор не найден в БД')
		return
	}

	const captureData = result.rows[0]
	console.log('[UpdateTime] Данные из БД получены:', captureData.target)

	// ✅ ИСПРАВЛЕНО: Проверяем тип данных перед парсингом
	// JSONB в PostgreSQL уже возвращается как объект, а не строка
	const safeParse = (data, fallback = []) => {
		if (Array.isArray(data)) return data // Уже массив
		if (typeof data === 'string') {
			try {
				return JSON.parse(data)
			} catch (e) {
				console.error('[UpdateTime] Ошибка парсинга JSON:', data)
				return fallback
			}
		}
		return fallback // null, undefined или что-то еще
	}

	const mainList = safeParse(captureData.main_list, [])
	const reserveList = safeParse(captureData.reserve_list, [])
	const leftList = safeParse(captureData.left_list, [])

	console.log('[UpdateTime] Списки:', {
		main: mainList.length,
		reserve: reserveList.length,
		left: leftList.length
	})

	// Пересобираем сообщение с новым временем
	const updatedMessageData = buildCaptureMessage(
		newTimestamp,
		mainList,
		reserveList,
		leftList,
		captureData.target,
		captureData.max_main,
		client.guilds.cache.first(), // guild for sorting
		safeParse(captureData.main_list_meta, []),
		safeParse(captureData.reserve_list_meta, []),
		safeParse(captureData.approved_users, []),
		captureData.approval_page || 0,
		captureData.sort_mode
	)

	// Ищем канал
	const channel = client.channels.cache.get(channelId)
	if (!channel) {
		console.error(
			`[UpdateTime] Канал ${channelId} не найден в cache, пытаемся fetch...`
		)
		try {
			const fetchedChannel = await client.channels.fetch(channelId)
			if (!fetchedChannel) {
				console.error('[UpdateTime] Канал не найден даже после fetch')
				return
			}
			const message = await fetchedChannel.messages.fetch(messageId)
			await message.edit(updatedMessageData)
			console.log('[UpdateTime] ✅ Сообщение успешно обновлено (через fetch)')
			return
		} catch (err) {
			console.error('[UpdateTime] Ошибка при fetch канала:', err.message)
			return
		}
	}

	try {
		console.log(`[UpdateTime] Канал найден, ищем сообщение ${messageId}...`)
		const message = await channel.messages.fetch(messageId)
		console.log('[UpdateTime] Сообщение найдено, обновляем...')
		await message.edit(updatedMessageData)
		console.log('[UpdateTime] ✅ Сообщение успешно обновлено')
	} catch (err) {
		console.error('[UpdateTime] Не удалось обновить сообщение:', err.message)
	}
}

async function sendCollection(
	interaction,
	discordTimestamp,
	target = null,
	maxMain = 20,
	sendReminders = true
) {
	const guild = interaction.guild
	const channel = guild.channels.cache.get(dashboard.getSetting('PLUS_CHANNEL_ID'))

	const mainList = []
	const reserveList = []
	const leftList = []
	// Track join timestamps: { userId: timestamp }
	const mainListMeta = []
	const reserveListMeta = []

	const messageData = buildCaptureMessage(
		discordTimestamp,
		mainList,
		reserveList,
		leftList,
		target,
		maxMain,
		guild,
		mainListMeta,
		reserveListMeta
	)
	const message = await channel.send(messageData)
	if (sendReminders) {
		for (let i = 0; i < 3; i++) {
			await channel.send({
				content: `<@&${dashboard.getSetting('AUTO_ROLE')}> рега выше`
			})
		}
	}

	try {
		await pool.query(
			`INSERT INTO active_captures (message_id, discord_timestamp, main_list, reserve_list, left_list, main_list_meta, reserve_list_meta, target, max_main)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[
				message.id,
				discordTimestamp,
				JSON.stringify(mainList),
				JSON.stringify(reserveList),
				JSON.stringify(leftList),
				JSON.stringify(mainListMeta),
				JSON.stringify(reserveListMeta),
				target,
				maxMain
			]
		)
	} catch (err) {
		console.error('Не удалось сохранить набор в БД:', err)
	}
}

async function handleButton(interaction) {
	if (!interaction.isButton()) return
	if (
		interaction.customId !== 'capt_join' &&
		interaction.customId !== 'capt_leave'
	)
		return

	// Сразу подтверждаем, чтобы Discord не слал "не ответило вовремя"
	await interaction.deferUpdate().catch(() => {})

	const messageId = interaction.message.id
	const userId = interaction.user.id

	const safeParse = (data, fallback = []) => {
		if (Array.isArray(data)) return data
		if (typeof data === 'string') {
			try {
				return JSON.parse(data)
			} catch {
				return fallback
			}
		}
		return fallback
	}

	const client = await pool.connect()
	try {
		await client.query('BEGIN')

		const res = await client.query(
			'SELECT * FROM active_captures WHERE message_id = $1 FOR UPDATE',
			[messageId]
		)
		const row = res.rows[0]

		if (!row) {
			await client.query('ROLLBACK')
			return interaction
				.followUp({
					content: '❌ Данная регистрация устарела или неактивна.',
					flags: [MessageFlags.Ephemeral]
				})
				.catch(() => {})
		}

		const discordTimestamp = row.discord_timestamp
		const target = row.target
		const maxMain = row.max_main || 20

		let mainList = safeParse(row.main_list, [])
		let reserveList = safeParse(row.reserve_list, [])
		let leftList = safeParse(row.left_list, [])
		let mainListMeta = safeParse(row.main_list_meta, [])
		let reserveListMeta = safeParse(row.reserve_list_meta, [])
		let approvedUsers = safeParse(row.approved_users, [])

		if (interaction.customId === 'capt_join') {
			if (mainList.includes(userId) || reserveList.includes(userId)) {
				await client.query('ROLLBACK')
				return interaction
					.followUp({
						content: 'Вы уже записаны на капт!',
						flags: [MessageFlags.Ephemeral]
					})
					.catch(() => {})
			}

			const leftIndex = leftList.indexOf(userId)
			if (leftIndex !== -1) leftList.splice(leftIndex, 1)

			const now = Date.now()
			if (approvedUsers.length === 0 && mainList.length < maxMain) {
				mainList.push(userId)
				mainListMeta.push({ userId, joinedAt: now })
			} else {
				reserveList.push(userId)
				reserveListMeta.push({ userId, joinedAt: now })
			}
		} else if (interaction.customId === 'capt_leave') {
			const mainIndex = mainList.indexOf(userId)
			const reserveIndex = reserveList.indexOf(userId)

			if (mainIndex === -1 && reserveIndex === -1) {
				await client.query('ROLLBACK')
				return interaction
					.followUp({
						content: 'Вас и так нет в списках.',
						flags: [MessageFlags.Ephemeral]
					})
					.catch(() => {})
			}

			if (mainIndex !== -1) {
				mainList.splice(mainIndex, 1)
				mainListMeta.splice(mainIndex, 1)
				if (approvedUsers.length === 0 && reserveList.length > 0) {
					const movingPlayer = reserveList.shift()
					const movingMeta = reserveListMeta.shift()
					mainList.push(movingPlayer)
					mainListMeta.push(movingMeta)
				}
			} else if (reserveIndex !== -1) {
				reserveList.splice(reserveIndex, 1)
				reserveListMeta.splice(reserveIndex, 1)
			}

			if (!leftList.includes(userId)) {
				leftList.push(userId)
			}
			const wasApproved = approvedUsers.includes(userId)
			approvedUsers = approvedUsers.filter(id => id !== userId)
			if (wasApproved && approvedUsers.length === 0) {
				const lists = redistributeApproved(
					mainList,
					reserveList,
					mainListMeta,
					reserveListMeta,
					approvedUsers,
					maxMain
				)
				mainList = lists.mainList
				reserveList = lists.reserveList
				mainListMeta = lists.mainMeta
				reserveListMeta = lists.reserveMeta
			}
		}

		await client.query(
			`UPDATE active_captures 
         SET main_list = $1, reserve_list = $2, left_list = $3, main_list_meta = $4, reserve_list_meta = $5, approved_users = $6
         WHERE message_id = $7`,
			[
				JSON.stringify(mainList),
				JSON.stringify(reserveList),
				JSON.stringify(leftList),
				JSON.stringify(mainListMeta),
				JSON.stringify(reserveListMeta),
				JSON.stringify(approvedUsers),
				messageId
			]
		)

		const updatedMessageData = buildCaptureMessage(
			discordTimestamp,
			mainList,
			reserveList,
			leftList,
			target,
			maxMain,
			interaction.guild,
			mainListMeta,
			reserveListMeta,
			approvedUsers,
			row.approval_page || 0,
			row.sort_mode
		)
		await interaction.editReply(updatedMessageData)
		await client.query('COMMIT')
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {})
		console.error('Ошибка при обработке кнопки капта:', err)
		await interaction
			.followUp({
				content: '❌ Произошла ошибка базы данных при сохранении.',
				flags: [MessageFlags.Ephemeral]
			})
			.catch(() => {})
	} finally {
		client.release()
	}
}

async function handleApproval(interaction) {
	const adminRoles = (dashboard.getSetting('ADMIN_ROLES') || '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean)
	const member = interaction.member
	if (
		!member ||
		(!member.permissions.has(PermissionFlagsBits.Administrator) &&
			!adminRoles.some(id => member.roles.cache.has(id)))
	) {
		return interaction.reply({
			content: '❌ У вас нет прав для управления набором.',
			flags: MessageFlags.Ephemeral
		})
	}
	await interaction.deferUpdate()
	let client
	try {
		client = await pool.connect()
		await client.query('BEGIN')
		const result = await client.query(
			'SELECT * FROM active_captures WHERE message_id = $1 FOR UPDATE',
			[interaction.message.id]
		)
		const row = result.rows[0]
		if (!row) {
			await client.query('ROLLBACK')
			return interaction.followUp({
				content: '❌ Данная регистрация устарела или неактивна.',
				flags: MessageFlags.Ephemeral
			})
		}
		const parse = value => {
			if (Array.isArray(value)) return value
			try {
				return JSON.parse(value || '[]')
			} catch {
				return []
			}
		}
		let main = parse(row.main_list)
		let reserve = parse(row.reserve_list)
		let mainMeta = parse(row.main_list_meta)
		let reserveMeta = parse(row.reserve_list_meta)
		let approved = parse(row.approved_users)
		let sortMode = row.sort_mode === 'time' ? 'time' : 'priority'
		let page = Math.max(
			0,
			Math.min(
				row.approval_page || 0,
				Math.max(
					0,
					Math.ceil((main.length + reserve.length) / APPROVAL_PAGE_SIZE) - 1
				)
			)
		)
		if (interaction.customId === 'capt_sort_toggle') {
			sortMode = sortMode === 'time' ? 'priority' : 'time'
		} else if (interaction.isStringSelectMenu()) {
			const group = approvalGroups(
				main,
				reserve,
				page,
				mainMeta,
				reserveMeta,
				interaction.guild,
				sortMode
			).find(items => approvalId(items) === interaction.customId)
			if (!group || interaction.values.some(id => !group.includes(id))) {
				await client.query('ROLLBACK')
				return interaction.followUp({
					content: 'Список изменился. Обновите сообщение и попробуйте снова.',
					flags: MessageFlags.Ephemeral
				})
			}
			approved = [
				...approved.filter(id => !group.includes(id)),
				...interaction.values
			]
			if (approved.length > (row.max_main || 20)) {
				await client.query('ROLLBACK')
				return interaction.followUp({
					content: `❌ Можно одобрить не более ${row.max_main || 20} участников.`,
					flags: MessageFlags.Ephemeral
				})
			}
			const lists = redistributeApproved(
				main,
				reserve,
				mainMeta,
				reserveMeta,
				approved,
				row.max_main || 20
			)
			main = lists.mainList
			reserve = lists.reserveList
			mainMeta = lists.mainMeta
			reserveMeta = lists.reserveMeta
		} else {
			const requestedPage = Number(
				interaction.customId.slice('capt_approval_page_'.length)
			)
			if (
				!Number.isInteger(requestedPage) ||
				requestedPage < 0 ||
				requestedPage >=
					Math.ceil((main.length + reserve.length) / APPROVAL_PAGE_SIZE)
			) {
				await client.query('ROLLBACK')
				return
			}
			page = requestedPage
		}
		await client.query(
			'UPDATE active_captures SET approved_users = $1, approval_page = $2, main_list = $3, reserve_list = $4, main_list_meta = $5, reserve_list_meta = $6, sort_mode = $8 WHERE message_id = $7',
			[
				JSON.stringify(approved),
				page,
				JSON.stringify(main),
				JSON.stringify(reserve),
				JSON.stringify(mainMeta),
				JSON.stringify(reserveMeta),
				interaction.message.id,
				sortMode
			]
		)
		await interaction.editReply(
			buildCaptureMessage(
				row.discord_timestamp,
				main,
				reserve,
				parse(row.left_list),
				row.target,
				row.max_main || 20,
				interaction.guild,
				mainMeta,
				reserveMeta,
				approved,
				page,
				sortMode
			)
		)
		await client.query('COMMIT')
	} catch (err) {
		if (client) await client.query('ROLLBACK').catch(() => {})
		console.error('Ошибка одобрения участников:', err)
		await interaction
			.followUp({
				content: '❌ Не удалось сохранить одобрение.',
				flags: MessageFlags.Ephemeral
			})
			.catch(() => {})
	} finally {
		if (client) client.release()
	}
}

module.exports = {
	buildCaptureMessage,
	redistributeApproved,
	updateCollectionTime,
	sendCollection,
	handleButton,
	handleApproval
}
