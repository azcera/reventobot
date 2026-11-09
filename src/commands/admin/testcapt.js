module.exports = {
	name: 'testcapt',
	description: 'Тестовая регистрация; !testcapt info [attack] — плашка последнего завершённого капта',
	async execute(message, args = []) {
		if (!message.client.familyWars) return message.reply('API-регистрация каптов временно отключена.')
		const preview = args[0]?.toLowerCase() === 'info'
		return message.client.familyWars.createTestRegistration(message, { preview,
			attackOnly: preview && args[1]?.toLowerCase() === 'attack' })
	}
}
