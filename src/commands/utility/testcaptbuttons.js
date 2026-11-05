const { startTest } = require('../../features/capture/testApproval')

module.exports = {
	name: 'testcaptbuttons',
	description: 'Тест одобрения участников через кнопки',
	async execute(message) {
		return startTest(message, 'buttons')
	}
}
