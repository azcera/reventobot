const { buildCaptureMessage } = require('../../features/capture/captureManager')

module.exports = {
	name: 'testcapt',
	description: 'Показывает тестовый набор со случайными участниками',
	async execute(message) {
		if (!message.guild) return

		const members = await message.guild.members.fetch()
		const candidates = [...members.values()].filter(member => !member.user.bot)
		if (candidates.length < 10) {
			return message.channel.send('❌ Для теста нужно не менее 10 участников сервера.')
		}

		for (let i = candidates.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
		}

		const mainList = candidates.slice(0, 10).map(member => member.id)
		const meta = mainList.map((userId, index) => ({ userId, joinedAt: index }))
		const payload = buildCaptureMessage(
			`<t:${Math.floor(Date.now() / 1000)}:F>`,
			mainList, [], [], 'тестовый капт', 10, message.guild, meta, []
		)
		for (const button of payload.components[1].components) button.setDisabled(true)
		return message.channel.send(payload)
	}
}
