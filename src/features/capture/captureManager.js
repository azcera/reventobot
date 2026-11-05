const {
	MessageFlags,
	ActionRowBuilder,
	TextDisplayBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	SeparatorBuilder,
	ChannelType
} = require('discord.js')
require('dotenv').config()

const pool = require('../../services/database.js')

const PLUS_CHANNEL = process.env.PLUS_CHANNEL_ID

// Parse PRIORITY_ROLES from env: comma-separated role IDs, highest priority first
const PRIORITY_ROLES = (process.env.PRIORITY_ROLES || '')
	.split(',')
	.map(id => id.trim())
	.filter(Boolean)

/**
 * Gets the priority index for a member based on their highest role.
 * Returns index in PRIORITY_ROLES array, or PRIORITY_ROLES.length if no match.
 * @param {GuildMember} member
 * @returns {number}
 */
function getRolePriority(member) {
	const sortedRoles = [...member.roles.cache.values()].sort((a, b) => b.position - a.position)
	for (const role of sortedRoles) {
		const idx = PRIORITY_ROLES.indexOf(role.id)
		if (idx !== -1) return idx
	}
	return PRIORITY_ROLES.length // lowest priority (after all configured roles)
}

/**
 * Sorts a list of user objects by role priority, then by join timestamp.
 * Each item: { userId, joinedAt }
 * @param {Array<{userId: string, joinedAt: number}>} list
 * @param {Guild} guild
 * @returns {Array<string>} sorted userIds
 */
function sortByRolePriority(list, guild) {
	return [...list].sort((a, b) => {
		const memberA = guild.members.cache.get(a.userId)
		const memberB = guild.members.cache.get(b.userId)
		
		const priorityA = memberA ? getRolePriority(memberA) : PRIORITY_ROLES.length
		const priorityB = memberB ? getRolePriority(memberB) : PRIORITY_ROLES.length
		
		if (priorityA !== priorityB) return priorityA - priorityB
		
		// Same priority: earlier join timestamp comes first
		return a.joinedAt - b.joinedAt
	}).map(item => item.userId)
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
	reserveListMeta = []
) {
	const title = new TextDisplayBuilder().setContent(
		`## 📢 Рега на ${target ?? 'капт'}!`
	)
	const time = new TextDisplayBuilder().setContent(
		'## Время проведения: ' + discordTimestamp
	)

	const helpText = new TextDisplayBuilder().setContent(
		'-# Нажмите на кнопку ниже, чтобы записаться на капт.'
	)

	// Sort main list and reserve list by role priority (then join order)
	const mainListWithMeta = (mainList || []).map((userId, index) => ({
		userId,
		joinedAt: mainListMeta[index]?.joinedAt ?? index
	}))
	const reserveListWithMeta = (reserveList || []).map((userId, index) => ({
		userId,
		joinedAt: reserveListMeta[index]?.joinedAt ?? index
	}))

	const sortedMainList = guild ? sortByRolePriority(mainListWithMeta, guild) : mainList || []
	const sortedReserveList = guild ? sortByRolePriority(reserveListWithMeta, guild) : reserveList || []

	const mainPlayersText =
		sortedMainList.length > 0
			? sortedMainList.map((id, index) => `${index + 1}. <@${id}>`).join('\n')
			: 'Пусто'
	const reservePlayersText =
		sortedReserveList.length > 0
			? sortedReserveList.map((id, index) => `${index + 1}. <@${id}>`).join('\n')
			: 'Пусто'
	const leftPlayersText =
		leftList.length > 0
			? leftList.map((id, index) => `• <@${id}>`).join('\n')
			: 'Пусто'

	const mainTitle = new TextDisplayBuilder().setContent(
		`### 👥 Основной состав (${sortedMainList.length}/${maxMain})\n${mainPlayersText}`
	)
	const reserveTitle = new TextDisplayBuilder().setContent(
		`### 🤝 Резерв (${sortedReserveList.length})\n${reservePlayersText}`
	)
	const leftTitle = new TextDisplayBuilder().setContent(
		`### 🚪 Покинули набор (${leftList.length})\n${leftPlayersText}`
	)

	const containerComponent = new ContainerBuilder()

	containerComponent.addTextDisplayComponents(title, time, helpText)

	containerComponent
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(mainTitle)

	if (reserveList.length > 0) {
		containerComponent
			.addSeparatorComponents(new SeparatorBuilder())
			.addTextDisplayComponents(reserveTitle)
	}

	if (leftList.length > 0) {
		containerComponent
			.addSeparatorComponents(new SeparatorBuilder())
			.addTextDisplayComponents(leftTitle)
	}

	// Кнопки управления для участников и админов
	const buttonsRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId('capt_join')
			.setLabel('✅ Принять')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId('capt_leave')
			.setLabel('❌ Выйти')
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('capt_edit_time_trigger') // Название кнопки для перехвата админ права
			.setLabel('✏️ Время')
			.setStyle(ButtonStyle.Secondary)
	)

	return {
		flags: MessageFlags.IsComponentsV2,
		components: [containerComponent, buttonsRow]
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
		safeParse(captureData.reserve_list_meta, [])
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
	maxMain = 20
) {
	const guild = interaction.guild
	const channel = guild.channels.cache.get(PLUS_CHANNEL)

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
	for (let i = 0; i < 3; i++) {
		await channel.send({
			content: `<@&${process.env.AUTO_ROLE}> рега выше`
		})
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
			if (mainList.length < maxMain) {
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
				if (reserveList.length > 0) {
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
		}

		await client.query(
			`UPDATE active_captures 
         SET main_list = $1, reserve_list = $2, left_list = $3, main_list_meta = $4, reserve_list_meta = $5
         WHERE message_id = $6`,
			[
				JSON.stringify(mainList),
				JSON.stringify(reserveList),
				JSON.stringify(leftList),
				JSON.stringify(mainListMeta),
				JSON.stringify(reserveListMeta),
				messageId
			]
		)

		await client.query('COMMIT')

		const updatedMessageData = buildCaptureMessage(
			discordTimestamp,
			mainList,
			reserveList,
			leftList,
			target,
			maxMain,
			interaction.guild,
			mainListMeta,
			reserveListMeta
		)
		await interaction.editReply(updatedMessageData)
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

module.exports = {
	buildCaptureMessage,
	updateCollectionTime,
	sendCollection,
	handleButton
}
