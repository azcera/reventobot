const { replyWithAutoDelete } = require('../../utils/autoDelete')

module.exports = {
	name: 'schedule',
	description: 'Публикует обновляемое расписание Mitsuki Hub в текущем канале',
	async execute(message) {
		const schedule = message.client.eventSchedule
		if (!schedule) return replyWithAutoDelete(message, { content: '❌ Расписание ещё не готово. Повторите позже.' })
		if (!schedule.canCreateGroup(message.member)) return replyWithAutoDelete(message, { content: '❌ Недостаточно прав.' })
		try {
			await schedule.publish(message.channel)
			await message.delete().catch(() => {})
		} catch (error) {
			console.error('[Schedule] Публикация:', error)
			await replyWithAutoDelete(message, { content: '❌ Не удалось опубликовать расписание. Проверьте доступность сайта и права бота в канале.' })
		}
	}
}
