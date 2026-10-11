const {
	MessageFlags,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder
} = require('discord.js')
const db = require('../../services/database')
const {
	logAction,
	buildContainer
} = require('../../features/invite/inviteUtils')

async function submitRejectModal(interaction) {
	const targetUserId = interaction.customId.split('_')[3]
	const reason = interaction.fields.getTextInputValue('reject_reason')

	await interaction
		.deferReply({ flags: [MessageFlags.Ephemeral] })
		.catch(() => {})

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
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### Отклонение заявки\nВаша заявка в ${interaction.guild.name} отклонена!!`
				)
			)
			.addSeparatorComponents(new SeparatorBuilder())
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`> Причина: ${reason}\n> Дата отклонения: <t:${Math.floor(Date.now() / 1000)}:F>`
				)
			)
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
		'отклонения',
		interaction.user.id,
		reason
	)
	await logAction(interaction.guild, logContainer)

	await db.query('DELETE FROM family_applications WHERE user_id = $1', [
		targetUserId
	])
	setTimeout(() => interaction.channel.delete().catch(() => {}), 5000)
}

module.exports = submitRejectModal
