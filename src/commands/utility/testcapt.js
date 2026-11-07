const { store: dashboard } = require('../../dashboard/store')
const { PermissionFlagsBits } = require('discord.js')
const captureManager = require('../../features/capture/captureManager')

module.exports = {
	name: 'testcapt',
	description: 'Создаёт тестовый набор без уведомлений',
	async execute(message) {
		if (!message.guild) return
		const adminRoles = (dashboard.getSetting('ADMIN_ROLES') || '')
			.split(',')
			.map(id => id.trim())
			.filter(Boolean)
		if (
			!message.member ||
			(!message.member.permissions.has(PermissionFlagsBits.Administrator) &&
				!adminRoles.some(id => message.member.roles.cache.has(id)))
		)
			return message.reply('❌ У вас нет прав для этого теста.')

		const timestamp = `<t:${Math.floor(Date.now() / 1000)}:F>`
		await captureManager.sendCollection(message, timestamp, 'тестовый капт', 20, false)
		await message.reply('✅ Тестовый набор создан.')
	}
}
