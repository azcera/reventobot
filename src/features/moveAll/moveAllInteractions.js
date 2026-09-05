const {
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ActionRowBuilder,
	MessageFlags,
	ChannelType
} = require('discord.js')
const { sendEphemeralWithAutoDelete } = require('../../utils/autoDelete')

async function showMoveAllSelect(interaction) {
	// Отвечаем сразу, чтобы избежать таймаута
	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

	const guild = interaction.guild

	// ✅ ИСПРАВЛЕНО: Используем ChannelType.GuildVoice вместо магического числа 2
	const voiceChannels = guild.channels.cache.filter(
		channel =>
			channel.type === ChannelType.GuildVoice && channel.name.includes('🔊')
	)

	// ✅ ИСПРАВЛЕНО: Проверяем, что есть голосовые каналы
	if (voiceChannels.size === 0) {
		return await interaction.editReply({
			content: '❌ На сервере нет голосовых каналов с 🔊 в названии.'
		})
	}

	voiceChannels.sort((a, b) => a.name.localeCompare(b.name))

	// ✅ ИСПРАВЛЕНО: Ограничиваем количество опций (Discord лимит - 25)
	const limitedChannels = voiceChannels.first(25)

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId('move_all_channel')
		.setPlaceholder('Выберите канал для перемещения...')
		.addOptions(
			limitedChannels.map(channel =>
				new StringSelectMenuOptionBuilder()
					.setLabel(channel.name.substring(0, 100)) // Discord лимит на длину label
					.setValue(channel.id)
			)
		)

	const row = new ActionRowBuilder().addComponents(selectMenu)

	await interaction.editReply({
		content: 'Пожалуйста, выберите канал для перемещения из списка ниже:',
		components: [row]
	})
}

async function handleMoveAllSelect(interaction) {
	if (interaction.customId !== 'move_all_channel') return

	// ✅ ИСПРАВЛЕНО: Отвечаем сразу, чтобы избежать таймаута
	await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

	const targetChannelId = interaction.values[0]
	const guild = interaction.guild

	const targetChannel = guild.channels.cache.get(targetChannelId)

	if (!targetChannel) {
		return await interaction.editReply({
			content: '❌ Выбранный канал не найден.'
		})
	}

	// ✅ ИСПРАВЛЕНО: Проверяем права ДО начала работы
	if (!guild.members.me.permissions.has('MoveMembers')) {
		return await interaction.editReply({
			content: '❌ У бота нет прав «Перемещение участников» на этом сервере.'
		})
	}

	// ✅ ИСПРАВЛЕНО: Фильтруем каналы правильно
	const otherVoiceChannels = guild.channels.cache.filter(
		channel =>
			channel.type === ChannelType.GuildVoice && channel.id !== targetChannelId
	)

	let movedCount = 0
	let failedCount = 0

	// ✅ ИСПРАВЛЕНО: Добавляем try/catch для всего цикла
	try {
		for (const [_, channel] of otherVoiceChannels) {
			for (const [_, member] of channel.members) {
				try {
					await member.voice.setChannel(targetChannel)
					movedCount++
				} catch (error) {
					console.error(
						`❌ Не удалось переместить ${member.user.tag}:`,
						error.message
					)
					failedCount++
				}
			}
		}

		// ✅ ИСПРАВЛЕНО: Показываем результат с информацией о неудачах
		let resultMessage = `✅ Успешно перемещено участников: **${movedCount}**`
		if (failedCount > 0) {
			resultMessage += `\n⚠️ Не удалось переместить: **${failedCount}**`
		}
		if (movedCount === 0 && failedCount === 0) {
			resultMessage =
				'ℹ️ В других голосовых каналах нет участников для перемещения.'
		}

		await interaction.editReply({
			content: resultMessage
		})
	} catch (error) {
		console.error('[MoveAll] Критическая ошибка при перемещении:', error)
		await interaction.editReply({
			content: '❌ Произошла ошибка при перемещении участников.'
		})
	}
}

module.exports = { showMoveAllSelect, handleMoveAllSelect }
