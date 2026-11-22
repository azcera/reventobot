import { Events } from 'discord.js'
import { store } from '../dashboard/store'
import { updateLists } from '../features/archive/updateLists'
import { scheduleArchiveAccess } from '../features/archive/archiveAccess'
import { getArchiveOwners, getArchiveThreads } from '../features/archive/unusedArchives'
import { recoverCollectionCreations } from '../features/capture/collectionCreation'
import {
	finishApplicationChannel,
	recoverApplicationCreations
} from '../features/invite/inviteUtils'
import { registerAdminApplicationCommands } from '../services/adminApplicationCommands'
import { createCaptureExpiry } from '../services/captureExpiry'
import { createCaptureRankings } from '../services/captureRankings'
import { createCaptureResults } from '../services/captureResults'
import { createEventSchedule } from '../services/eventSchedule'
import { createFamilyMembership } from '../services/familyMembership'
import { loadDiscordMembers } from '../services/discordMembers'
import { seedMemberStatics } from '../services/memberIdentity'
import { createMajesticNicknameScheduler } from '../services/majesticNicknameScheduler'
import { createMajesticSync } from '../services/majesticSync'
import { getError } from '../utils/errors'
import { parseDisplayName } from '../utils/parseDisplayName'
import pool = require('../services/database')

export = (client: import('discord.js').Client) => {
	client.once(Events.ClientReady, async readyClient => {
		console.log(`✅ Готово! Вход как ${readyClient.user.tag}`)
		client.captureExpiry = createCaptureExpiry({ client, pool, store })
		client.captureExpiry.start()
		client.captureResults ||= createCaptureResults({ client, pool })
		client.captureResults.start()
		client.eventSchedule = createEventSchedule({ client, pool, store })
		client.eventSchedule.start().catch(error => {
			client.eventSchedule = null
			console.error('[Schedule] Ошибка запуска:', error)
		})
		client.majesticSync ||= createMajesticSync({ pool, store })
		client.majesticNicknames = createMajesticNicknameScheduler({
			client,
			sync: client.majesticSync,
			store
		})
		client.majesticNicknames.start()
		client.captureRankings = createCaptureRankings({ pool, store })
		client.familyMembership = createFamilyMembership({
			client,
			pool,
			store,
			sync: client.majesticSync,
			onSnapshot: client.captureRankings.updateRoster
		})
		client.familyMembership.start()
		const guild = client.guilds.cache.get(process.env.GUILD_ID || '')
		if (guild) {
			scheduleArchiveAccess(guild)
			client.captureRankings.start(guild)
			let active: Promise<void> | undefined
			const reconcile = async () => {
				await Promise.allSettled([
					recoverCollectionCreations(client, pool).catch(error =>
						console.error('[Collection creation recovery]', error)
					),
					(async () => {
						await recoverApplicationCreations(guild)
						const { rows } = await pool.query(
							`SELECT channel_id FROM family_applications
							WHERE guild_id = $1 AND status IN ('accepted', 'rejected')
							AND modified_at < NOW() - INTERVAL '10 seconds'`,
							[guild.id]
						)
						for (const row of rows)
							await finishApplicationChannel(guild, row.channel_id).catch(
								console.error
							)
					})().catch(error => console.error('[Invite channel cleanup]', error))
				])
			}
			function tick() {
				active ??= reconcile().finally(() => {
					active = undefined
				})
			}
			const timer = setInterval(tick, 30000)
			timer.unref()
			client.stopReconciliation = async () => {
				clearInterval(timer)
				await active
			}
			tick()
			try {
				await registerAdminApplicationCommands(client, guild, store)
			} catch (caught) {
				const error = getError(caught)
				console.error('❌ Ошибка регистрации команд приложения:', error)
			}
			try {
				await client.roleCurators?.sync(guild)
			} catch (caught) {
				const error = getError(caught)
				console.error('[Role curators] Ошибка синхронизации:', error)
			}
			try {
				await client.capturePresets?.sync(guild)
			} catch (caught) {
				console.error(
					'[Capture presets] Ошибка синхронизации:',
					getError(caught)
				)
			}
			try {
				const statics = new Map<string, string>()
				for (const member of (await loadDiscordMembers(guild)).values()) {
					if (member.user.bot) continue
					const parsed = parseDisplayName(member.displayName)
					if (parsed) statics.set(member.id, parsed.memberStatic)
				}
				await seedMemberStatics(guild.id, statics)
				if (store.getSetting('PARENT_CHANNEL_ID'))
					await getArchiveOwners(guild, await getArchiveThreads(guild))
			} catch (error) {
				console.error('[Archive registry] Не удалось заполнить реестр', getError(error).message)
			}
			try {
				await updateLists(guild)
				console.log('✅ Успешное обновление списков.')
			} catch (caught) {
				const error = getError(caught)
				console.error('❌ Ошибка при обновлении списков:', error)
			}
		} else console.error(`❌ Сервер с ID ${process.env.GUILD_ID} не найден.`)
	})
}
