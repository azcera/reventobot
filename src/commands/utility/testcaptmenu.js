const { startTest } = require('../../features/capture/testApproval')

module.exports = {
	name: 'testcaptmenu',
	description: 'Тест одобрения участников через меню',
	async execute(message) {
		return startTest(message, 'select')
	}
}
