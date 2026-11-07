const { Events } = require('discord.js')
const { updateLists } = require('../features/archive/updateLists')
const { createFamilyWars } = require('../services/familyWars')
const { createMajesticSync } = require('../services/majesticSync')
const { createMajesticNicknameScheduler } = require('../services/majesticNicknameScheduler')
const { store } = require('../dashboard/store')
const pool = require('../services/database')

module.exports = client => {
	client.once(Events.ClientReady, async readyClient => {
		console.log(`✅ Готово! Вход как ${readyClient.user.tag}`)
		client.familyWars = createFamilyWars({ client, pool, store })
		client.familyWars.start()
		client.majesticSync ||= createMajesticSync({ pool, store })
		client.majesticNicknames = createMajesticNicknameScheduler({ client, sync: client.majesticSync, store })
		client.majesticNicknames.start()
		const guild = client.guilds.cache.get(process.env.GUILD_ID)
		if (guild) {
			try {
				await updateLists(guild)
				console.log('✅ Успешное обновление списков.')
			} catch (error) {
				console.error('❌ Ошибка при обновлении списков:', error)
			}
		} else console.error(`❌ Сервер с ID ${process.env.GUILD_ID} не найден.`)
	})
}
