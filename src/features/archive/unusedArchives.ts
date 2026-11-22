import {
	ChannelType,
	Collection,
	MessageType,
	type Guild,
	type GuildMember,
	type Message,
	type ThreadChannel
} from 'discord.js'
import { store } from '../../dashboard/store'
import { loadDiscordMembers } from '../../services/discordMembers'
import { getMemberArchives, getMemberIdentity, linkMemberArchive, withMemberArchiveLock } from '../../services/memberIdentity'
import type { RawComponent } from '../../types'
import { parseDisplayName } from '../../utils/parseDisplayName'

const archiveNamePattern = /^archive .+ \d+$/

function archiveName(member: GuildMember) {
	const parsed = parseDisplayName(member.displayName)
	return parsed
		? `archive ${parsed.memberName.toLowerCase()} ${parsed.memberStatic}`
		: null
}

function isArchiveUsed(name: string, members: Iterable<GuildMember>) {
	return [...members].some(
		member => !member.user.bot && archiveName(member) === name.toLowerCase()
	)
}

async function fetchArchiveThreads(
	guild: Guild,
	parentId = store.getSetting('PARENT_CHANNEL_ID'),
	includeRenamed = false
) {
	const parent = await guild.channels.fetch(parentId)
	if (parent?.type !== ChannelType.GuildText)
		throw new Error('Канал архивов недоступен.')
	const threads = new Collection<string, ThreadChannel>()
	const active = await parent.threads.fetchActive()
	for (const [id, thread] of active.threads) threads.set(id, thread)
	for (const type of ['public', 'private'] as const) {
		let before: Date | undefined
		for (;;) {
			const page = await parent.threads.fetchArchived({
				type,
				fetchAll: true,
				limit: 100,
				before
			})
			for (const [id, thread] of page.threads) threads.set(id, thread)
			if (!page.hasMore) break
			const timestamps = [...page.threads.values()]
				.map(thread => thread.archiveTimestamp)
				.filter((time): time is number => time !== null)
			const oldest = Math.min(...timestamps)
			if (!Number.isFinite(oldest) || (before && oldest >= before.getTime()))
				throw new Error('Не удалось прочитать все архивные ветки.')
			before = new Date(oldest)
		}
	}
	return includeRenamed ? threads : threads.filter(thread => archiveNamePattern.test(thread.name))
}

const inventories = new WeakMap<Guild, {
	parentId: string
	expires: number
	threads: ReturnType<typeof fetchArchiveThreads>
}>()

function invalidateArchiveInventory(guild: Guild) {
	inventories.delete(guild)
}

function getArchiveThreads(guild: Guild) {
	const parentId = store.getSetting('PARENT_CHANNEL_ID')
	const cached = inventories.get(guild)
	if (cached?.parentId === parentId && cached.expires > Date.now()) return cached.threads
	const threads = fetchArchiveThreads(guild, parentId, true).catch(error => {
		if (inventories.get(guild)?.threads === threads) invalidateArchiveInventory(guild)
		throw error
	})
	inventories.set(guild, { parentId, expires: Date.now() + 60000, threads })
	return threads
}

function isArchiveThread(thread: ThreadChannel, owners: Map<string, string>) {
	return owners.has(thread.id) || archiveNamePattern.test(thread.name)
}

async function getUnusedArchives(guild: Guild, fresh = false) {
	const members = await loadDiscordMembers(guild, { force: fresh })
	const names = new Set(
		[...members.values()].filter(member => !member.user.bot).map(archiveName)
	)
	const threads = await fetchArchiveThreads(guild)
	return [...threads.values()]
		.filter(thread => !names.has(thread.name.toLowerCase()))
		.sort(
			(a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)
		)
}

function welcomeOwner(message: Message, botId: string) {
	if (
		message.author.id !== botId ||
		message.type !== MessageType.Default ||
		message.attachments.size
	)
		return null
	const textContents = (component: RawComponent): string[] => [
		component.content || '',
		...(component.components || []).flatMap(textContents)
	]
	const texts = [
		message.content,
		...message.components.flatMap(component =>
			textContents(component.toJSON() as RawComponent)
		)
	]
	return (
		texts
			.map(
				text =>
					text.match(
						/^(?:## )?<@!?(\d{17,20})>(?:,\s*это твой личный канал-архив|\r?\n### Это твой личный канал-архив)/i
					)?.[1]
			)
			.find(Boolean) || null
	)
}

async function readArchiveHistory(thread: ThreadChannel) {
	let before: string | undefined
	let latestId: string | undefined
	let lastAuthorId: string | undefined
	let foundMessage = false
	const owners = new Set<string>()
	let hasMessages = false
	for (;;) {
		const messages = await thread.messages.fetch({
			limit: 100,
			before,
			cache: false
		})
		if (!before) latestId = messages.first()?.id
		if (!foundMessage) {
			const last = messages.find(message => !message.system)
			if (last) {
				foundMessage = true
				if (!last.author.bot) lastAuthorId = last.author.id
			}
		}
		for (const message of messages.values()) {
			const owner = welcomeOwner(message, thread.client.user.id)
			if (owner) owners.add(owner)
			if (message.author.id !== thread.client.user.id && !message.system)
				hasMessages = true
		}
		if (messages.size < 100) break
		const next = messages.last()!.id
		if (next === before) throw new Error('Не удалось прочитать историю архива.')
		before = next
	}
	return { ownerId: owners.size === 1 ? [...owners][0] : null, hasMessages, lastAuthorId, latestId }
}

type CachedHistory = {
	lastMessageId: string | null
	history: ReturnType<typeof readArchiveHistory>
}
const histories = new WeakMap<Guild, Map<string, CachedHistory>>()

function invalidateArchiveHistory(guild: Guild, threadId: string) {
	histories.get(guild)?.delete(threadId)
	lastAuthors.get(guild)?.delete(threadId)
}

function getArchiveHistory(thread: ThreadChannel) {
	const cache = histories.get(thread.guild) ?? new Map<string, CachedHistory>()
	histories.set(thread.guild, cache)
	const previous = cache.get(thread.id)
	if (previous && previous.lastMessageId === thread.lastMessageId)
		return previous.history
	const history = readArchiveHistory(thread).catch(error => {
		if (cache.get(thread.id)?.history === history) cache.delete(thread.id)
		throw error
	})
	cache.set(thread.id, { lastMessageId: thread.lastMessageId, history })
	return history
}

const lastAuthors = new WeakMap<Guild, Map<string, {
	id: string | null
	author: Promise<string | undefined>
}>>()

function rememberLastArchiveAuthor(guild: Guild, message: Message) {
	if (message.system) return
	const cache = lastAuthors.get(guild) ?? new Map()
	lastAuthors.set(guild, cache)
	cache.set(message.channelId, { id: message.id, author: Promise.resolve(message.author.bot ? undefined : message.author.id) })
}

async function fetchLastArchiveAuthor(thread: ThreadChannel) {
	let before: string | undefined
	for (;;) {
		const limit = before ? 100 : 1
		const messages = await thread.messages.fetch({ limit, before, cache: false })
		const last = messages.find(message => !message.system)
		if (last) return last.author.bot ? undefined : last.author.id
		if (messages.size < limit) return undefined
		const next = messages.lastKey()
		if (!next || next === before) throw new Error('Не удалось прочитать последнее сообщение архива.')
		before = next
	}
}

async function getLastArchiveAuthor(thread: ThreadChannel) {
	const history = histories.get(thread.guild)?.get(thread.id)
	if (history && history.lastMessageId === thread.lastMessageId)
		return (await history.history).lastAuthorId
	const cache = lastAuthors.get(thread.guild) ?? new Map()
	lastAuthors.set(thread.guild, cache)
	const previous = cache.get(thread.id)
	if (previous && previous.id === thread.lastMessageId) return previous.author
	const author = fetchLastArchiveAuthor(thread).catch(error => {
		if (cache.get(thread.id)?.author === author) cache.delete(thread.id)
		throw error
	})
	cache.set(thread.id, { id: thread.lastMessageId, author })
	return author
}

// Discover legacy owners from the bot's welcome. Names and statics are editable.
async function loadArchiveOwners(guild: Guild, threads: Collection<string, ThreadChannel>) {
	const records = await getMemberArchives(guild.id)
	const owners = new Map(records.map(row => [row.archive_thread_id!, row.discord_id]))
	const registered = new Set(owners.values())
	const unlinked = [...threads.values()].filter(thread => !owners.has(thread.id) && archiveNamePattern.test(thread.name))
	const candidates = new Map<string, ThreadChannel[]>()
	for (let offset = 0; offset < unlinked.length; offset += 6) {
		const page = unlinked.slice(offset, offset + 6)
		const results = await Promise.allSettled(page.map(getArchiveHistory))
		for (const [index, result] of results.entries()) {
			if (result.status === 'rejected') {
				console.error('[Archives] Не удалось определить владельца', page[index].id, result.reason)
				continue
			}
			const { ownerId } = result.value
			if (!ownerId || registered.has(ownerId)) continue
			const matches = candidates.get(ownerId) ?? []
			matches.push(page[index])
			candidates.set(ownerId, matches)
		}
	}
	for (const [ownerId, matches] of candidates) {
		if (matches.length !== 1) continue
		const [thread] = matches
		const gameStatic = thread.name.match(/ (\d+)$/)?.[1] ?? null
		const linked = await withMemberArchiveLock(guild.id, ownerId, async db => {
			const current = await getMemberIdentity(guild.id, ownerId, db)
			if (current?.archive_thread_id) return current.archive_thread_id === thread.id
			return linkMemberArchive(guild.id, ownerId, thread.id, gameStatic, db)
		})
		if (linked) owners.set(thread.id, ownerId)
	}
	return owners
}

const ownerLoads = new WeakMap<Collection<string, ThreadChannel>, ReturnType<typeof loadArchiveOwners>>()

function getArchiveOwners(guild: Guild, threads: Collection<string, ThreadChannel>) {
	let pending = ownerLoads.get(threads)
	if (!pending) {
		pending = loadArchiveOwners(guild, threads).finally(() => ownerLoads.delete(threads))
		ownerLoads.set(threads, pending)
	}
	return pending
}

async function getDepartedArchives(guild: Guild, threads?: Collection<string, ThreadChannel>, owners?: Map<string, string>) {
	const members = await loadDiscordMembers(guild)
	threads ??= await getArchiveThreads(guild)
	owners ??= await getArchiveOwners(guild, threads)
	const cache = histories.get(guild)
	if (cache) for (const id of cache.keys()) if (!threads.has(id)) cache.delete(id)
	const empty: ThreadChannel[] = []
	const withMessages: ThreadChannel[] = []
	const archives = [...threads.values()].filter(thread => {
		const ownerId = owners.get(thread.id)
		return ownerId && !members.has(ownerId)
	}).sort(
		(a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)
	)
	for (let offset = 0; offset < archives.length; offset += 6) {
		const page = archives.slice(offset, offset + 6)
		const results = await Promise.allSettled(page.map(getArchiveHistory))
		for (const [index, result] of results.entries()) {
			const thread = page[index]
			if (result.status === 'rejected') {
				console.error('[Archives] Не удалось прочитать историю ветки', thread.id, result.reason)
				continue
			}
			const { hasMessages } = result.value
			const list = hasMessages ? withMessages : empty
			list.push(thread)
		}
	}
	return { empty, withMessages }
}

// The initial member-add notice is generated by Discord before the welcome.
async function inspectEmptyArchive(thread: ThreadChannel) {
	let before: string | undefined,
		ownerId: string | null = null,
		latestId: string | undefined,
		welcomeId: string | undefined
	const joins: Message[] = []
	for (;;) {
		const messages = await thread.messages.fetch({
			limit: 100,
			before,
			cache: false
		})
		if (!latestId) latestId = messages.first()?.id
		for (const message of messages.values()) {
			if (
				message.type === MessageType.ChannelNameChange &&
				message.author.id === thread.client.user.id
			)
				continue
			if (
				message.type === MessageType.RecipientAdd &&
				message.author.id === thread.client.user.id
			) {
				joins.push(message)
				continue
			}
			const owner = welcomeOwner(message, thread.client.user.id)
			if (!owner || ownerId) return null
			ownerId = owner
			welcomeId = message.id
		}
		if (messages.size < 100) break
		const next = messages.last()!.id
		if (next === before) throw new Error('Не удалось прочитать историю архива.')
		before = next
	}
	if (!ownerId || !latestId || !welcomeId || joins.length > 1) return null
	if (
		joins.some(
			message =>
				BigInt(message.id) >= BigInt(welcomeId!) ||
				message.mentions.users.size !== 1 ||
				!message.mentions.users.has(ownerId!)
		)
	)
		return null
	return { ownerId, latestId }
}

async function memberIsPresent(guild: Guild, id: string) {
	try {
		await guild.members.fetch({ user: id, force: true })
		return true
	} catch (error) {
		if ((error as { code?: number }).code === 10007) return false
		throw error
	}
}

const deleting = new Set<string>()

async function deleteEmptyArchive(
	thread: ThreadChannel,
	expectedOwner?: string
) {
	if (deleting.has(thread.id)) return false
	deleting.add(thread.id)
	try {
		if (
			thread.parentId !== store.getSetting('PARENT_CHANNEL_ID') ||
			!/^archive .+ \d+$/.test(thread.name)
		)
			return false
		const empty = await inspectEmptyArchive(thread)
		if (!empty || (expectedOwner && expectedOwner !== empty.ownerId))
			return false
		if (expectedOwner && !store.getSetting('ARCHIVE_AUTO_DELETE_EMPTY'))
			return false
		if (await memberIsPresent(thread.guild, empty.ownerId)) return false
		const members = await loadDiscordMembers(thread.guild)
		if (isArchiveUsed(thread.name, members.values())) return false
		const staticId = thread.name.match(/ (\d+)$/)?.[1]
		if (
			[...members.values()].some(
				member =>
					!member.user.bot &&
					member.displayName.match(/\|\s*(\d+)/)?.[1] === staticId
			)
		)
			return false
		const latest = await thread.messages.fetch({ limit: 1, cache: false })
		if (latest.first()?.id !== empty.latestId) return false
		await thread.delete('Пустой архив: владелец вышел с сервера')
		console.info('[Archives] Удалён пустой архив', {
			threadId: thread.id,
			ownerId: empty.ownerId
		})
		return true
	} finally {
		deleting.delete(thread.id)
	}
}

async function cleanupUnusedEmptyArchives(guild: Guild, apply = false) {
	const unused = await getUnusedArchives(guild)
	const result = {
		checked: unused.length,
		empty: [] as string[],
		deleted: [] as string[],
		failed: [] as string[]
	}
	for (const thread of unused) {
		try {
			const empty = await inspectEmptyArchive(thread)
			if (!empty || (await memberIsPresent(guild, empty.ownerId))) continue
			result.empty.push(thread.id)
			if (apply && (await deleteEmptyArchive(thread)))
				result.deleted.push(thread.id)
		} catch (error) {
			result.failed.push(thread.id)
			console.error(
				'[Archives] Не удалось проверить/удалить ветку',
				thread.id,
				(error as Error).message
			)
		}
	}
	return result
}

export {
	cleanupUnusedEmptyArchives,
	deleteEmptyArchive,
	fetchArchiveThreads,
	getArchiveHistory,
	getArchiveOwners,
	getArchiveThreads,
	getLastArchiveAuthor,
	getDepartedArchives,
	getUnusedArchives,
	inspectEmptyArchive,
	invalidateArchiveHistory,
	invalidateArchiveInventory,
	isArchiveThread,
	isArchiveUsed,
	memberIsPresent,
	readArchiveHistory,
	rememberLastArchiveAuthor
}
