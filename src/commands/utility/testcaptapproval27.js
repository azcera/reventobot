const { createTest } = require('./testcaptapproval')

module.exports = {
	name: 'testcaptapproval27',
	description: 'Создаёт тестовый набор из 27 участников',
	async execute(message) {
		return createTest(message, 27)
	}
}
