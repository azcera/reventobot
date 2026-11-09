const { Events } = require('discord.js')
const { updateLists } = require('../features/archive/updateLists')
const { createMajesticSync } = require('../services/majesticSync')
const { createMajesticNicknameScheduler } = require('../services/majesticNicknameScheduler')
const { createFamilyMembership } = require('../services/familyMembership')
const { store } = require('../dashboard/store')
const pool = require('../services/database')
const { createEventSchedule } = require('../services/eventSchedule')
const { registerAdminApplicationCommands } = require('../services/adminApplicationCommands')

module.exports = client => {
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
		const guild = client.guilds.cache.get(process.env.GUILD_ID)
		if (guild) {
			try {
				await registerAdminApplicationCommands(client, guild, store)
			} catch (error) {
				console.error('❌ Ошибка регистрации команд приложения:', error)
			}
			try {
				await client.mclLists.sync(guild)
			} catch (error) { console.error('[MCL] Ошибка синхронизации:', error) }
			try {
				await updateLists(guild)
				console.log('✅ Успешное обновление списков.')
			} catch (error) {
				console.error('❌ Ошибка при обновлении списков:', error)
			}
		} else console.error(`❌ Сервер с ID ${process.env.GUILD_ID} не найден.`)
	})
}
