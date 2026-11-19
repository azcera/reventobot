import {
	ChannelType,
	Guild,
	MessageType,
	PermissionFlagsBits,
	SeparatorBuilder,
	TextDisplayBuilder,
	type ThreadChannel
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import { getError } from '../../utils/errors'
require('dotenv').config()

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000 // 7 дней в миллисекундах

type Latest = {
	id: string | null
	expires: number
	unanswered: Promise<boolean>
}
const latest = new WeakMap<Guild, Map<string, Latest>>()

function invalidateUnanswered(guild: Guild, threadId: string) {
	latest.get(guild)?.delete(threadId)
}

async function needsAnswer(thread: ThreadChannel) {
	const messages = await thread.messages.fetch({ limit: 1, cache: false })
	const last = messages.first()
	if (!last || Date.now() - last.createdTimestamp > SEVEN_DAYS) return false
	const author =
		last.member ?? (await thread.guild.members.fetch(last.author.id))
	const repliedUserId =
		last.type === MessageType.Reply ? last.mentions.repliedUser?.id : undefined
	const hasMention =
		last.mentions.everyone ||
		last.mentions.roles.size > 0 ||
		last.mentions.users.some(user => user.id !== repliedUserId)
	const isAdmin =
		author.permissions.has(PermissionFlagsBits.Administrator) ||
		author.roles.cache.some(role =>
			dashboard.roleIds('ADMIN_ROLES').includes(role.id)
		)
	return (!last.author.bot && hasMention) || !isAdmin
}

async function getUnansweredList(guild: Guild) {
	const channelId = dashboard.getSetting('PARENT_CHANNEL_ID')
	const archiveChannel =
		guild.channels.cache.get(channelId) ??
		(await guild.channels.fetch(channelId))
	if (archiveChannel?.type !== ChannelType.GuildText) {
		console.error('❌ Неправильно настроен канал с архивами.')
		return
	}
	const { threads } = await archiveChannel.threads.fetchActive()
	const cache = latest.get(guild) ?? new Map<string, Latest>()
	latest.set(guild, cache)
	for (const id of cache.keys()) if (!threads.has(id)) cache.delete(id)
	const unansweredList: ThreadChannel[] = []
	const archives = [...threads.values()]
	for (let offset = 0; offset < archives.length; offset += 6) {
		await Promise.all(
			archives.slice(offset, offset + 6).map(async thread => {
				let entry = cache.get(thread.id)
				if (
					!entry ||
					entry.id !== thread.lastMessageId ||
					entry.expires <= Date.now()
				) {
					entry = {
						id: thread.lastMessageId,
						expires: Date.now() + 90000,
						unanswered: needsAnswer(thread)
					}
					cache.set(thread.id, entry)
				}
				try {
					if (await entry.unanswered) unansweredList.push(thread)
				} catch (error) {
					if (cache.get(thread.id) === entry) cache.delete(thread.id)
					console.error(
						`❌ Ошибка при обработке ветки ${thread.id}:`,
						getError(error).message
					)
				}
			})
		)
	}

	const build = (lines: string) =>
		dashboard.decorate(
			'unanswered',
			new ContainerBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(dashboard.text('unanswered.1'))
				)
				.addSeparatorComponents(new SeparatorBuilder())
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines))
		)
	if (!unansweredList.length) return [build(dashboard.text('unanswered.empty'))]
	unansweredList.sort(
		(a, b) =>
			Number(a.name.match(/(\d+)\s*$/)?.[1] ?? 0) -
			Number(b.name.match(/(\d+)\s*$/)?.[1] ?? 0)
	)

	const pages: ContainerBuilder[] = []
	const lines = unansweredList.map(
		(thread, index) => `${index + 1}. <#${thread.id}>`
	)
	let cursor = 0
	while (cursor < lines.length) {
		let end = Math.min(lines.length, cursor + 150)
		let page = build(lines.slice(cursor, end).join('\n'))
		for (;;) {
			try {
				page.toJSON()
				break
			} catch (error) {
				if (end <= cursor + 1) throw error
				end = cursor + Math.floor((end - cursor) / 2)
				page = build(lines.slice(cursor, end).join('\n'))
			}
		}
		pages.push(page)
		cursor = end
	}
	return pages
}

export { getUnansweredList, invalidateUnanswered }
