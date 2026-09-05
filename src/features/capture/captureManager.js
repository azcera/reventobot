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

function buildCaptureMessage(
	discordTimestamp,
	mainList,
	reserveList,
	leftList,
	target,
	maxMain
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

	const mainPlayersText =
		mainList.length > 0
			? mainList.map((id, index) => `${index + 1}. <@${id}>`).join('\n')
			: 'Пусто'
	const reservePlayersText =
		reserveList.length > 0
			? reserveList.map((id, index) => `${index + 1}. <@${id}>`).join('\n')
			: 'Пусто'
	const leftPlayersText =
		leftList.length > 0
			? leftList.map((id, index) => `• <@${id}>`).join('\n')
			: 'Пусто'

	const mainTitle = new TextDisplayBuilder().setContent(
		`### 👥 Основной состав (${mainList.length}/${maxMain})\n${mainPlayersText}`
	)
	const reserveTitle = new TextDisplayBuilder().setContent(
		`### 🤝 Резерв (${reserveList.length})\n${reservePlayersText}`
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
		captureData.max_main
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

	const messageData = buildCaptureMessage(
		discordTimestamp,
		mainList,
		reserveList,
		leftList,
		target,
		maxMain
	)
	const message = await channel.send(messageData)
	for (let i = 0; i < 3; i++) {
		await channel.send({
			content: `<@&${process.env.AUTO_ROLE}> рега выше`
		})
	}

	try {
		await pool.query(
			`INSERT INTO active_captures (message_id, discord_timestamp, main_list, reserve_list, left_list, target, max_main)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				message.id,
				discordTimestamp,
				JSON.stringify(mainList),
				JSON.stringify(reserveList),
				JSON.stringify(leftList),
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

	const messageId = interaction.message.id

	let row
	try {
		const res = await pool.query(
			'SELECT * FROM active_captures WHERE message_id = $1',
			[messageId]
		)
		row = res.rows[0]
	} catch (err) {
		console.error('Ошибка при поиске набора в БД:', err)
	}

	if (!row) {
		return interaction.reply({
			content: '❌ Данная регистрация устарела или неактивна.',
			flags: [MessageFlags.Ephemeral]
		})
	}

	const discordTimestamp = row.discord_timestamp
	const target = row.target
	const maxMain = row.max_main || 20

	let mainList = row.main_list || []
	let reserveList = row.reserve_list || []
	let leftList = row.left_list || []

	const userId = interaction.user.id

	if (interaction.customId === 'capt_join') {
		if (mainList.includes(userId) || reserveList.includes(userId)) {
			return interaction.reply({
				content: 'Вы уже записаны на капт!',
				flags: [MessageFlags.Ephemeral]
			})
		}

		const leftIndex = leftList.indexOf(userId)
		if (leftIndex !== -1) leftList.splice(leftIndex, 1)

		if (mainList.length < maxMain) {
			mainList.push(userId)
		} else {
			reserveList.push(userId)
		}
	} else if (interaction.customId === 'capt_leave') {
		const mainIndex = mainList.indexOf(userId)
		const reserveIndex = reserveList.indexOf(userId)

		if (mainIndex === -1 && reserveIndex === -1) {
			return interaction.reply({
				content: 'Вас и так нет в списках.',
				flags: [MessageFlags.Ephemeral]
			})
		}

		if (mainIndex !== -1) {
			mainList.splice(mainIndex, 1)

			if (reserveList.length > 0) {
				const movingPlayer = reserveList.shift()
				mainList.push(movingPlayer)
			}
		} else if (reserveIndex !== -1) {
			reserveList.splice(reserveIndex, 1)
		}

		if (!leftList.includes(userId)) {
			leftList.push(userId)
		}
	}

	try {
		await pool.query(
			`UPDATE active_captures 
         SET main_list = $1, reserve_list = $2, left_list = $3
         WHERE message_id = $4`,
			[
				JSON.stringify(mainList),
				JSON.stringify(reserveList),
				JSON.stringify(leftList),
				messageId
			]
		)
	} catch (err) {
		console.error('Не удалось обновить данные набора в БД:', err)
		return interaction.reply({
			content: '❌ Произошла ошибка базы данных при сохранении.',
			flags: [MessageFlags.Ephemeral]
		})
	}

	const updatedMessageData = buildCaptureMessage(
		discordTimestamp,
		mainList,
		reserveList,
		leftList,
		target,
		maxMain
	)
	await interaction.update(updatedMessageData)
}
module.exports = {
	buildCaptureMessage,
	updateCollectionTime,
	sendCollection,
	handleButton
}
