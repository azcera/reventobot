const { MessageFlags, PermissionFlagsBits } = require('discord.js')
const {
	buildCaptureMessage,
	redistributeApproved
} = require('../../features/capture/captureManager')

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

module.exports = {
	name: 'testcaptselection',
	description: 'Создаёт тестовый набор для проверки одобрения',
	async execute(message) {
		await message.delete().catch(() => {})
		return this.createTest(message, 27)
	},
	async createTest(message, count) {
		if (!message.guild) return
		if (!hasAccess(message.member))
			return message.reply('❌ У вас нет прав для этого теста.')
		const members = await message.guild.members.fetch()
		const candidates = [...members.values()].filter(member => !member.user.bot)
		if (candidates.length < count)
			return message.reply(
				`❌ Для теста нужно не менее ${count} участников сервера.`
			)
		for (let i = candidates.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
		}
		const ids = candidates.slice(0, count).map(member => member.id)
		const maxMain = count === 10 ? 5 : 20
		let main = ids.slice(0, maxMain)
		let reserve = ids.slice(maxMain)
		const meta = list =>
			list.map(userId => ({ userId, joinedAt: ids.indexOf(userId) }))
		let mainMeta = meta(main)
		let reserveMeta = meta(reserve)
		const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`
		let approved = []
		function build(disabled = false) {
			const payload = buildCaptureMessage(
				timestamp,
				main,
				reserve,
				[],
				'тестовый капт',
				maxMain,
				message.guild,
				mainMeta,
				reserveMeta,
				approved
			)
			for (const button of payload.components[1].components)
				button.setDisabled(true)
			for (const row of payload.components.slice(2)) {
				const menu = row.components[0]
				menu.setCustomId(`test_${menu.data.custom_id}`).setDisabled(disabled)
			}
			payload.allowedMentions = { parse: [] }
			return payload
		}
		const sent = await message.channel.send(build())
		const collector = sent.createMessageComponentCollector({
			time: 60 * 60 * 1000
		})
		collector.on('collect', async interaction => {
			try {
				if (!hasAccess(interaction.member)) {
					return await interaction.reply({
						content: '❌ У вас нет прав для одобрения участников.',
						flags: MessageFlags.Ephemeral
					})
				}
				const menu = build()
					.components.slice(2)
					.map(row => row.components[0].toJSON())
					.find(item => item.custom_id === interaction.customId)
				if (
					!menu ||
					!interaction.isStringSelectMenu() ||
					interaction.values.some(
						id => !menu.options.some(option => option.value === id)
					)
				)
					return
				const group = new Set(menu.options.map(option => option.value))
				approved = [
					...approved.filter(id => !group.has(id)),
					...interaction.values
				]
				const lists = redistributeApproved(
					main,
					reserve,
					mainMeta,
					reserveMeta,
					approved,
					maxMain
				)
				main = lists.mainList
				reserve = lists.reserveList
				mainMeta = lists.mainMeta
				reserveMeta = lists.reserveMeta
				await interaction.update(build())
			} catch (err) {
				console.error('Ошибка тестового одобрения:', err)
			}
		})
		collector.on('end', () => sent.edit(build(true)).catch(() => {}))
	}
}
