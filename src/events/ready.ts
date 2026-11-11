import { getError } from '../utils/errors'
import { Events } from 'discord.js'
import { updateLists } from '../features/archive/updateLists'
import { createMajesticSync } from '../services/majesticSync'
import { createMajesticNicknameScheduler } from '../services/majesticNicknameScheduler'
import { createFamilyMembership } from '../services/familyMembership'
import { store } from '../dashboard/store'
import pool = require('../services/database')
import { createEventSchedule } from '../services/eventSchedule'
import { registerAdminApplicationCommands } from '../services/adminApplicationCommands'

export = (client: import('discord.js').Client) => {
	client.once(Events.ClientReady, async readyClient => {
		console.log(`✅ Готово! Вход как ${readyClient.user.tag}`)
		client.eventSchedule = createEventSchedule({ client, pool, store })
		client.eventSchedule.start().catch(error => {
			client.eventSchedule = null
			console.error('[Schedule] Ошибка запуска:', error)
		})
		client.majesticSync ||= createMajesticSync({ pool, store })
		client.majesticNicknames = createMajesticNicknameScheduler({ client, sync: client.majesticSync, store })
		client.majesticNicknames.start()
		client.familyMembership = createFamilyMembership({ client, pool, store, sync: client.majesticSync })
		client.familyMembership.start()
		const guild = client.guilds.cache.get(process.env.GUILD_ID || '')
		if (guild) {
			try {
				await registerAdminApplicationCommands(client, guild, store)
			} catch (caught) {
 const error = getError(caught);
				console.error('❌ Ошибка регистрации команд приложения:', error)
			}
			try {
				await client.mclLists?.sync(guild)
			} catch (caught) {
 const error = getError(caught); console.error('[MCL] Ошибка синхронизации:', error) }
			try {
				await updateLists(guild)
				console.log('✅ Успешное обновление списков.')
			} catch (caught) {
 const error = getError(caught);
				console.error('❌ Ошибка при обновлении списков:', error)
			}
		} else console.error(`❌ Сервер с ID ${process.env.GUILD_ID} не найден.`)
	})
}
