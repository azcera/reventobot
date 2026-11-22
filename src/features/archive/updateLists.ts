import {
	ChannelType,
	ComponentType,
	Guild,
	MessageFlags,
	type APIMessageComponent,
	type Message,
	type TextChannel
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { isMembershipMessage } from '../../services/familyMembership'
import { getError } from '../../utils/errors'
import { getUnusedArchiveLists } from './archiveCleanupInteractions'
import { getArchivesLists } from './archivesList'
import { getUnansweredList } from './archiveUnansweredList'
import { invalidateArchiveHistory } from './unusedArchives'
import pool = require('../../services/database')
require('dotenv').config()

/**
 * Отправляет или изменяет сообщение в панель управления
 * @param {Guild} guild
 */
const updates = new WeakMap<Guild, { pending: Promise<void>; rerun: boolean }>()
const reconciledChannels = new WeakSet<TextChannel>()

function listSignature(components: APIMessageComponent[]) {
	// Discord adds component IDs and default fields to messages fetched from history.
	return JSON.stringify(components, (key, value) => {
		if (
			key === 'id' ||
			((key === 'accent_color' || key === 'emoji') && value === null) ||
			(key === 'spoiler' && value === false) ||
			(key === 'divider' && value === true) ||
			(key === 'spacing' && value === 1)
		)
			return undefined
		if (value?.type && !Array.isArray(value)) {
			return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
		}
		return value
	})
}

function messageSignature(message: Message) {
	if (message.components.length !== 1 || message.components[0].type !== ComponentType.Container)
		return undefined
	return listSignature(message.components.map(component => component.toJSON()))
}

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
	const reconcile = !reconciledChannels.has(adminChannel)
	const signatures = new Map<string, string[]>()
	const remember = (signature: string, key: string) => {
		const keys = signatures.get(signature) ?? []
		if (!keys.includes(key)) keys.push(key)
		signatures.set(signature, keys)
	}
	if (reconcile) {
		for (const [key, page] of pending) remember(listSignature([page.container.toJSON()]), key)
	}
	const retained = new Set<string>()
	const ownsMessage = (message: Message) =>
		message.author.id === guild.client.user.id &&
		!message.webhookId &&
		!isMembershipMessage(message)
	const register = async (
		message: Message,
		{ type, part }: Pick<(typeof containers)[number], 'type' | 'part'>
	) => {
		await pool.query(
			`INSERT INTO settings_archive_messages (message_id, discord_timestamp, type, part, guild_id, channel_id)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (message_id) DO UPDATE SET type = EXCLUDED.type, part = EXCLUDED.part,
				guild_id = EXCLUDED.guild_id, channel_id = EXCLUDED.channel_id`,
			[message.id, message.createdTimestamp, type, part, guild.id, adminChannel.id]
		)
	}
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
		const owned = message && ownsMessage(message)
		// Legacy IDs only identify their original page. Leave ambiguous duplicates in place.
		if (owned && !row.channel_id && !page) continue
		if (owned && page) {
			if (reconcile && row.channel_id) {
				const signature = messageSignature(message)
				if (signature) remember(signature, key)
			}
			await message.edit({
				components: [page.container],
				allowedMentions: { parse: [] }
			})
			await pool.query(
				'UPDATE settings_archive_messages SET guild_id = $2, channel_id = $3 WHERE message_id = $1',
				[message.id, guild.id, adminChannel.id]
			)
			pending.delete(key)
			retained.add(message.id)
			continue
		}
		if (owned) await message.delete()
		await pool.query(
			'DELETE FROM settings_archive_messages WHERE message_id = $1',
			[row.message_id]
		)
	}

	if (reconcile) {
		// The previous publisher could leave pages in Discord without registry rows.
		const legacyIds = new Set(rows.filter(row => !row.channel_id).map(row => row.message_id))
		let before: string | undefined
		for (;;) {
			const messages = await adminChannel.messages.fetch({ limit: 100, before, cache: false })
			for (const message of messages.values()) {
				if (retained.has(message.id) || !ownsMessage(message)) continue
				const signature = messageSignature(message)
				const keys = signature && signatures.get(signature)
				if (!keys) continue
				const key = keys.find(key => pending.has(key))
				const page = key && pending.get(key)
				if (key && page) {
					await register(message, page)
					pending.delete(key)
				} else {
					await message.delete()
					if (legacyIds.has(message.id)) await pool.query(
						'DELETE FROM settings_archive_messages WHERE message_id = $1', [message.id]
					)
				}
			}
			if (messages.size < 100) break
			before = messages.last()!.id
		}
		reconciledChannels.add(adminChannel)
	}

	for (const { type, part, container } of pending.values()) {
		const message = await adminChannel.send({
			components: [container],
			flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
			allowedMentions: { parse: [] }
		})
		try {
			await register(message, { type, part })
		} catch (error) {
			await message.delete().catch(console.error)
			throw error
		}
	}
}

const scheduled = new WeakMap<Guild, ReturnType<typeof setTimeout>>()
function scheduleArchiveListRefresh(guild: Guild, threadId: string) {
	invalidateArchiveHistory(guild, threadId)
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
