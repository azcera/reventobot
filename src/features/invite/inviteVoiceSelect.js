const { store: dashboard } = require('../../dashboard/store')
const { ContainerBuilder } = require('../../services/markdownContainer')
const {
	MessageFlags,
	TextDisplayBuilder,
	SeparatorBuilder
} = require('discord.js')
const db = require('../../services/database')
const { editReplyWithAutoDelete } = require('../../utils/autoDelete')
const {
	isApplicationMod,
	logAction,
	buildContainer
} = require('../../features/invite/inviteUtils')

async function handleVoiceSelect(interaction) {
	// Ответом на выбор комнаты управляет только этот обработчик.
	try {
		await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })
	} catch (error) {
		console.error('Ошибка подтверждения выбора комнаты:', error)
		return
	}

	if (!isApplicationMod(interaction.member)) {
		return editReplyWithAutoDelete(interaction, {
			content: '❌ Недостаточно прав.'
		})
	}

	const targetUserId = interaction.customId.split('_')[3]
	const voiceChannelId = interaction.values[0]

	const res = await db.query(
		'SELECT * FROM family_applications WHERE user_id = $1',
		[targetUserId]
	)
	if (res.rows.length === 0) {
		return editReplyWithAutoDelete(interaction, {
			content: '❌ Заявка не найдена (возможно, она уже была обработана).'
		})
	}
	const appData = res.rows[0]

	// Отправляем сообщение в канал заявки (НЕ эфемерное, чтобы все видели)
	await interaction.channel
		.send({
			content: `> 📢 <@${targetUserId}>, вы были вызваны на обзвон.\n> Администратор: <@${interaction.user.id}>!\n> Голосовой канал: <#${voiceChannelId}>`
		})
		.catch(console.error)

	const targetUser = await interaction.client.users
		.fetch(targetUserId)
		.catch(() => null)
	if (targetUser) {
		const container = new ContainerBuilder()
			.setAccentColor(0xe67e22)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard.text('dm.document.interview', { server: interaction.guild.name, channel: voiceChannelId, time: Math.floor(Date.now() / 1000) })))

		await targetUser
			.send({
				components: [container.toJSON()],
				flags: [MessageFlags.IsComponentsV2]
			})
			.catch(() => {})
	}

	const logContainer = await buildContainer(
		targetUserId,
		appData.full_name,
		appData.age,
		appData.about_and_expectations,
		appData.previous_experience,
		'обзвона',
		interaction.user.id,
		voiceChannelId
	)
	await logAction(interaction.guild, logContainer)

	return editReplyWithAutoDelete(interaction, {
		content: '✅ Кандидат успешно вызван на обзвон!'
	})
}

module.exports = { handleVoiceSelect }
