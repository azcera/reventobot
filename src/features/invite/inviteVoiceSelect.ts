import { getError } from '../../utils/errors'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	MessageFlags,
	TextDisplayBuilder,
	SeparatorBuilder
} from 'discord.js'
import db = require('../../services/database')
import { editReplyWithAutoDelete } from '../../utils/autoDelete'
import {
	isApplicationMod,
	logAction,
	buildContainer
} from '../../features/invite/inviteUtils'

async function handleVoiceSelect(interaction: import('discord.js').StringSelectMenuInteraction<'cached'>) {
	// Ответом на выбор комнаты управляет только этот обработчик.
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral as const })
	} catch (caught) {
 const error = getError(caught);
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
	await interaction.channel!
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
				flags: MessageFlags.IsComponentsV2 as const
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

export { handleVoiceSelect }
