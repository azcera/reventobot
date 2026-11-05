const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	StringSelectMenuBuilder,
	TextDisplayBuilder
} = require('discord.js')

function hasAccess(member) {
	const roles = (process.env.ADMIN_ROLES || '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean)
	return (
		member &&
		(member.permissions.has(PermissionFlagsBits.Administrator) ||
			roles.some(id => member.roles.cache.has(id)))
	)
}

async function startTest(message, mode) {
	if (!message.guild) return
	if (!hasAccess(message.member))
		return message.reply('❌ У вас нет прав для этого теста.')

	const members = await message.guild.members.fetch()
	const candidates = [...members.values()].filter(member => !member.user.bot)
	for (let i = candidates.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
	}
	const players = candidates.slice(0, 25)
	if (!players.length)
		return message.reply('❌ На сервере нет участников для теста.')

	const approved = new Set()
	let page = 0
	const pageSize = 10
	const pages = Math.ceil(players.length / pageSize)

	function build(disabled = false) {
		const container = new ContainerBuilder().addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`## 📢 Тест одобрения: ${mode === 'select' ? 'меню' : 'кнопки'}\n-# Тестовый список, данные не сохраняются.`
			)
		)
		if (mode === 'select') {
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					players
						.map(
							(member, i) =>
								`${i + 1}. <@${member.id}>${approved.has(member.id) ? ' ✅' : ''}`
						)
						.join('\n')
				)
			)
			const menu = new StringSelectMenuBuilder()
				.setCustomId('test_approval_select')
				.setPlaceholder('Выберите одобренных участников')
				.setMinValues(0)
				.setMaxValues(players.length)
				.setDisabled(disabled)
				.addOptions(
					players.map(member => ({
						label: (member.displayName || member.user.username).slice(0, 100),
						value: member.id,
						default: approved.has(member.id)
					}))
				)
			container.addActionRowComponents(
				new ActionRowBuilder().addComponents(menu)
			)
		} else {
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`Страница ${page + 1}/${pages}`)
			)
			players
				.slice(page * pageSize, (page + 1) * pageSize)
				.forEach((member, i) => {
					container.addSectionComponents(
						new SectionBuilder()
							.addTextDisplayComponents(
								new TextDisplayBuilder().setContent(
									`${page * pageSize + i + 1}. <@${member.id}>${approved.has(member.id) ? ' ✅' : ''}`
								)
							)
							.setButtonAccessory(
								new ButtonBuilder()
									.setCustomId(`test_approval_toggle_${member.id}`)
									.setLabel(approved.has(member.id) ? 'Отменить' : 'Одобрить')
									.setStyle(
										approved.has(member.id)
											? ButtonStyle.Success
											: ButtonStyle.Secondary
									)
									.setDisabled(disabled)
							)
					)
				})
			if (pages > 1)
				container.addActionRowComponents(
					new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId('test_approval_prev')
							.setLabel('◀')
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(disabled || page === 0),
						new ButtonBuilder()
							.setCustomId('test_approval_next')
							.setLabel('▶')
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(disabled || page === pages - 1)
					)
				)
		}
		return {
			flags: MessageFlags.IsComponentsV2,
			components: [container],
			allowedMentions: { parse: [] }
		}
	}

	const sent = await message.channel.send(build())
	const collector = sent.createMessageComponentCollector({
		time: 60 * 60 * 1000
	})
	collector.on('collect', async interaction => {
		if (!hasAccess(interaction.member)) {
			return interaction.reply({
				content: '❌ У вас нет прав для одобрения.',
				flags: MessageFlags.Ephemeral
			})
		}
		if (
			interaction.customId === 'test_approval_select' &&
			interaction.isStringSelectMenu()
		) {
			approved.clear()
			interaction.values.forEach(id => approved.add(id))
		} else if (interaction.customId.startsWith('test_approval_toggle_')) {
			const id = interaction.customId.slice('test_approval_toggle_'.length)
			if (approved.has(id)) approved.delete(id)
			else approved.add(id)
		} else if (interaction.customId === 'test_approval_prev')
			page = Math.max(0, page - 1)
		else if (interaction.customId === 'test_approval_next')
			page = Math.min(pages - 1, page + 1)
		else return
		await interaction.update(build())
	})
	collector.on('end', () => sent.edit(build(true)).catch(() => {}))
}

module.exports = { startTest }
