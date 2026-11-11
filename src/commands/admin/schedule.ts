import { getError } from '../../utils/errors'
import { replyWithAutoDelete } from '../../utils/autoDelete'
import { store } from '../../dashboard/store'
import { PermissionFlagsBits } from 'discord.js'

export = {
	name: 'schedule',
	description: 'Публикует обновляемое расписание Majestic RP в текущем канале',
	async execute(message: import('discord.js').Message<true>) {
		const schedule = message.client.eventSchedule
		if (!schedule) return replyWithAutoDelete(message, { content: '❌ Расписание ещё не готово. Повторите позже.' })
		if (!message.member || (!message.member.permissions.has(PermissionFlagsBits.Administrator) && !store.roleIds('ADMIN_ROLES').some(id => message.member!.roles.cache.has(id)))) return replyWithAutoDelete(message, { content: '❌ Недостаточно прав.' })
		try {
			await schedule.publish(message.channel)
			await message.delete().catch(() => {})
		} catch (caught) {
 const error = getError(caught);
			console.error('[Schedule] Публикация:', error)
			await replyWithAutoDelete(message, { content: '❌ Не удалось опубликовать расписание. Проверьте подключение к базе и права бота в канале.' })
		}
	}
}
