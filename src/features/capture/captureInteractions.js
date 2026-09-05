const {
	MessageFlags,
	ActionRowBuilder,
	TextDisplayBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	SeparatorBuilder
} = require('discord.js')
require('dotenv').config()

const pool = require('../../services/database.js')
const { replyWithAutoDelete } = require('../../utils/autoDelete.js')

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
			.setCustomId('capt_edit_time_trigger')
			.setLabel('✏️ Время')
			.setStyle(ButtonStyle.Secondary)
	)

	return {
		flags: MessageFlags.IsComponentsV2,
		components: [containerComponent, buttonsRow]
	}
}

module.exports = {
	buildCaptureMessage,

	async sendCollection(
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
			console.error('❌ Не удалось сохранить набор в БД:', err)
		}
	},

	/**
	 * Обновляет время в сообщении набора после редактирования
	 * @param {string} messageId - ID сообщения в канале
	 * @param {string} channelId - ID канала, где находится сообщение
	 * @param {string} newTimestamp - Новый Discord timestamp
	 * @param {Client} client - Discord клиент для поиска сообщения
	 */
	async updateCollectionTime(messageId, channelId, newTimestamp, client) {
		// ✅ ИСПРАВЛЕНО: db.query → pool.query
		const result = await pool.query(
			'SELECT * FROM active_captures WHERE message_id = $1',
			[messageId]
		)

		if (result.rows.length === 0) {
			console.error('[UpdateTime] Набор не найден в БД')
			return
		}

		const captureData = result.rows[0]

		// ✅ ИСПРАВЛЕНО: правильный порядок аргументов (timestamp первым!)
		const updatedMessageData = buildCaptureMessage(
			newTimestamp,
			JSON.parse(captureData.main_list || '[]'),
			JSON.parse(captureData.reserve_list || '[]'),
			JSON.parse(captureData.left_list || '[]'),
			captureData.target,
			captureData.max_main
		)

		// Ищем сообщение в канале (так как interaction.message может быть недоступно при submit модалки)
		const channel = client.channels.cache.get(channelId)
		if (!channel) {
			console.error('[UpdateTime] Канал не найден')
			return
		}

		try {
			const message = await channel.messages.fetch(messageId)
			// ✅ ИСПРАВЛЕНО: передаем весь объект, а не заворачиваем в components
			await message.edit(updatedMessageData)
		} catch (err) {
			console.error('[UpdateTime] Не удалось обновить сообщение:', err)
		}
	},

	async handleButton(interaction) {
		if (!interaction.isButton()) return

		const customId = interaction.customId

		// ✅ ИСПРАВЛЕНО: убираем ранний return, чтобы обрабатывать и другие кнопки
		if (
			customId !== 'capt_join' &&
			customId !== 'capt_leave' &&
			customId !== 'capt_edit_time_trigger'
		) {
			return
		}

		// Обработка кнопки редактирования времени (просто отвечаем, чтобы избежать таймаута)
		// Сама логика показа модалки находится в interactionCreate.js
		if (customId === 'capt_edit_time_trigger') {
			// Ничего не делаем здесь - обработка в interactionCreate
			return
		}

		const messageId = interaction.message.id

		let row
		try {
			const res = await pool.query(
				'SELECT * FROM active_captures WHERE message_id = $1',
				[messageId]
			)
			row = res.rows[0]
		} catch (err) {
			console.error('❌ Ошибка при поиске набора в БД:', err)
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

		if (customId === 'capt_join') {
			if (mainList.includes(userId) || reserveList.includes(userId)) {
				return await replyWithAutoDelete(interaction, {
					content: '❌ Вы уже записаны на капт!'
				})
			}

			const leftIndex = leftList.indexOf(userId)
			if (leftIndex !== -1) leftList.splice(leftIndex, 1)

			if (mainList.length < maxMain) {
				mainList.push(userId)
			} else {
				reserveList.push(userId)
			}
		} else if (customId === 'capt_leave') {
			const mainIndex = mainList.indexOf(userId)
			const reserveIndex = reserveList.indexOf(userId)

			if (mainIndex === -1 && reserveIndex === -1) {
				return await replyWithAutoDelete(interaction, {
					content: '❌ Вас и так нет в списках.'
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
			return await replyWithAutoDelete(interaction, {
				content: '❌ Произошла ошибка базы данных при сохранении.'
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
}
