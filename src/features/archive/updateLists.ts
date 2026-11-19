import { ChannelType, Guild, MessageFlags } from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { isMembershipMessage } from '../../services/familyMembership'
import { getError } from '../../utils/errors'
import { getUnusedArchiveLists } from './archiveCleanupInteractions'
import { getArchivesLists } from './archivesList'
import {
	getUnansweredList,
	invalidateUnanswered
} from './archiveUnansweredList'
import pool = require('../../services/database')
require('dotenv').config()

/**
 * Отправляет или изменяет сообщение в панель управления
 * @param {Guild} guild
 */
const updates = new WeakMap<Guild, { pending: Promise<void>; rerun: boolean }>()

async function updateLists(guild: Guild) {
	const previous = updates.get(guild)
	if (previous) {
		previous.rerun = true
		return previous.pending
	}
	const state = { pending: Promise.resolve(), rerun: false }
	updates.set(guild, state)
	state.pending = (async () => {
		try {
			do {
				state.rerun = false
				await refreshLists(guild)
			} while (state.rerun)
		} finally {
			updates.delete(guild)
		}
	})()
	return state.pending
}

async function refreshLists(guild: Guild) {
	if (
		[
			'PARENT_CHANNEL_ID',
			'ARCHIVE_SETTINGS_CHANNEL',
			'AUTO_ROLE',
			'ARCHIVE_GROUP_ROLES'
		].some(key => !dashboard.getSetting(key).trim())
	) {
		console.warn(
			'⚠️ Обновление списков архивов пропущено: заполните настройки архивов в дашборде.'
		)
		return
	}
	const pages = [
		{ type: 'unused', items: await getUnusedArchiveLists(guild) },
		{ type: 'all', items: (await getArchivesLists(guild))?.parts || [] },
		{ type: 'unanswered', items: (await getUnansweredList(guild)) || [] }
	] as const
	const containers = pages.flatMap(({ type, items }) =>
		items.map((container, index) => ({ type, part: index + 1, container }))
	)
	if (containers.length < 1)
		return console.error('❌ Ошибка обновления архивных списков: списки пусты')

	const adminChannel =
		guild.channels.cache.get(
			dashboard.getSetting('ARCHIVE_SETTINGS_CHANNEL')
		) ||
		(await guild.channels.fetch(
			dashboard.getSetting('ARCHIVE_SETTINGS_CHANNEL')
		))

	if (
		!adminChannel ||
		(adminChannel && adminChannel.type != ChannelType.GuildText)
	) {
		return console.error(
			'❌ Канал архивных списков не настроен или отсутствует'
		)
	}

	const { rows } = await pool.query<{
		message_id: string
		type: string
		part: number
		channel_id: string | null
	}>(
		`
		SELECT message_id, type, part, channel_id FROM settings_archive_messages
		WHERE (guild_id = $1 AND channel_id = $2) OR (guild_id IS NULL AND channel_id IS NULL AND type IN ('all', 'unanswered'))
		ORDER BY message_id`,
		[guild.id, adminChannel.id]
	)
	const pending = new Map(
		containers.map(page => [`${page.type}:${page.part}`, page])
	)
	for (const row of rows) {
		const message = await adminChannel.messages
			.fetch({ message: row.message_id, force: true, cache: false })
			.catch(error => {
				if (Number(getError(error).code) === 10008) return null
				throw error
			})
		if (!message && !row.channel_id) continue
		const key = `${row.type}:${row.part}`
		const page = pending.get(key)
		const owned =
			message &&
			message.author.id === guild.client.user.id &&
			!message.webhookId &&
			!isMembershipMessage(message)
		// Legacy IDs only identify their original page. Leave ambiguous duplicates in place.
		if (owned && !row.channel_id && !page) continue
		if (owned && page) {
			await message.edit({
				components: [page.container],
				flags: MessageFlags.IsComponentsV2
			})
			await pool.query(
				'UPDATE settings_archive_messages SET guild_id = $2, channel_id = $3 WHERE message_id = $1',
				[message.id, guild.id, adminChannel.id]
			)
			pending.delete(key)
			continue
		}
		if (owned) await message.delete()
		await pool.query(
			'DELETE FROM settings_archive_messages WHERE message_id = $1',
			[row.message_id]
		)
	}

	for (const { type, part, container } of pending.values()) {
		const message = await adminChannel.send({
			components: [container],
			flags: MessageFlags.IsComponentsV2
		})
		try {
			await pool.query(
				`INSERT INTO settings_archive_messages (message_id, discord_timestamp, type, part, guild_id, channel_id)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				[
					message.id,
					message.createdTimestamp,
					type,
					part,
					guild.id,
					adminChannel.id
				]
			)
		} catch (error) {
			await message.delete().catch(console.error)
			throw error
		}
	}
}

const scheduled = new WeakMap<Guild, ReturnType<typeof setTimeout>>()
function scheduleArchiveListRefresh(guild: Guild, threadId: string) {
	invalidateUnanswered(guild, threadId)
	if (scheduled.has(guild)) return
	const timer = setTimeout(() => {
		scheduled.delete(guild)
		void updateLists(guild).catch(error =>
			console.error('[Archives refresh]', error)
		)
	}, 3000)
	timer.unref()
	scheduled.set(guild, timer)
}

export { scheduleArchiveListRefresh, updateLists }
