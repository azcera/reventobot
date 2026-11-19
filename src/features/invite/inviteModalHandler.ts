import { MessageFlags, TextDisplayBuilder } from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import {
	buildContainer,
	finishApplicationChannel,
	isApplicationMod,
	logAction
} from '../../features/invite/inviteUtils'
import { ContainerBuilder } from '../../services/markdownContainer'
import db = require('../../services/database')

async function submitRejectModal(
	interaction: import('discord.js').ModalSubmitInteraction<'cached'>
) {
	const [, , , targetUserId, guildId, channelId] =
		interaction.customId.split('_')
	const reason = interaction.fields.getTextInputValue('reject_reason')
	await interaction.deferReply({ flags: MessageFlags.Ephemeral })
	if (
		!targetUserId ||
		guildId !== interaction.guildId ||
		channelId !== interaction.channelId
	) {
		return interaction.editReply(
			'❌ Эта форма относится к устаревшей заявке. Откройте форму заново.'
		)
	}

	let appData
	try {
		const member = await interaction.guild.members.fetch({
			user: interaction.user.id,
			force: true,
			cache: false
		})
		if (!isApplicationMod(member))
			return interaction.editReply('❌ У вас нет прав для управления заявками.')
		const { rows } = await db.query(
			`UPDATE family_applications SET status = 'rejected', guild_id = $3, modified_at = NOW()
			WHERE user_id = $1 AND channel_id = $2 AND (guild_id IS NULL OR guild_id = $3)
			AND COALESCE(status, 'pending') = 'pending' RETURNING *`,
			[targetUserId, channelId, guildId]
		)
		appData = rows[0]
	} catch (error) {
		console.error('[Invite reject]', error)
		return interaction.editReply(
			'❌ Не удалось отклонить заявку. Повторите попытку позже.'
		)
	}
	if (!appData)
		return interaction.editReply('❌ Заявка уже обработана или недоступна.')
	setTimeout(
		() =>
			finishApplicationChannel(interaction.guild, channelId).catch(
				console.error
			),
		5000
	).unref()
	await interaction
		.editReply(`✅ Заявка <@${targetUserId}> отклонена`)
		.catch(() => {})

	const targetUser = await interaction.client.users
		.fetch(targetUserId)
		.catch(() => null)

	if (targetUser) {
		const container = new ContainerBuilder()
			.setAccentColor(0xe74c3c)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					dashboard.text('dm.document.rejected', {
						server: interaction.guild.name,
						reason,
						time: Math.floor(Date.now() / 1000)
					})
				)
			)
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
}

export = submitRejectModal
