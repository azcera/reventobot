module.exports = {
	name: 'testcapt',
	description: 'Тестовая регистрация по составу последнего завершённого капта',
	async execute(message) {
		if (!message.client.familyWars) return message.reply('Модуль каптов ещё не готов. Повторите позже.')
		return message.client.familyWars.createTestRegistration(message)
	}
}
