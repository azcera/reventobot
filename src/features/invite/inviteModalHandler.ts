import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	MessageFlags,
	TextDisplayBuilder,
	SeparatorBuilder
} from 'discord.js'
import db = require('../../services/database')
import {
	logAction,
	buildContainer
} from '../../features/invite/inviteUtils'

async function submitRejectModal(interaction: import('discord.js').ModalSubmitInteraction<'cached'>) {
	const targetUserId = interaction.customId.split('_')[3]
	const reason = interaction.fields.getTextInputValue('reject_reason')

	await interaction
		.deferReply({ flags: MessageFlags.Ephemeral as const })

	const res = await db.query(
		'SELECT * FROM family_applications WHERE user_id = $1',
		[targetUserId]
	)
	if (res.rows.length === 0) {
		return interaction
			.editReply({
				content: '❌ Заявка не найдена.'
			})
			.catch(() => {})
	}
	const appData = res.rows[0]

	await interaction
		.editReply({
			content: `✅ Заявка <@${targetUserId}> отклонена`
		})
		.catch(() => {})

	const targetUser = await interaction.client.users
		.fetch(targetUserId)
		.catch(() => null)

	if (targetUser) {
		const container = new ContainerBuilder()
			.setAccentColor(0xe74c3c)
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard.text('dm.document.rejected', { server: interaction.guild.name, reason, time: Math.floor(Date.now() / 1000) })))
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
		'отклонения',
		interaction.user.id,
		reason
	)
	await logAction(interaction.guild, logContainer)

	await db.query('DELETE FROM family_applications WHERE user_id = $1', [
		targetUserId
	])
	setTimeout(() => interaction.channel?.delete().catch(() => {}), 5000)
}

export = submitRejectModal
