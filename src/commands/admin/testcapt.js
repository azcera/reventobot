module.exports = {
	name: 'testcapt',
	description: 'Тестовая регистрация; !testcapt info — плашка последнего завершённого капта',
	async execute(message, args = []) {
		if (!message.client.familyWars) return message.reply('Модуль каптов ещё не готов. Повторите позже.')
		return message.client.familyWars.createTestRegistration(message, { preview: args[0]?.toLowerCase() === 'info' })
	}
}
