import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type ThreadChannel } from 'discord.js'
import type { ArchiveAccessStatus } from '../../../shared/archiveAccess'
import { store } from '../../dashboard/store'
import { loadDiscordMembers } from '../../services/discordMembers'
import { getError } from '../../utils/errors'
import { getArchiveOwners, getArchiveThreads, invalidateArchiveInventory, isArchiveThread } from './unusedArchives'

function archiveRank(member: GuildMember, roles: readonly string[]) {
	const rank = roles.findIndex(id => member.roles.cache.has(id))
	return rank < 0 ? Infinity : rank
}

function canViewArchive(viewer: GuildMember, owner: GuildMember | undefined, roles: readonly string[]) {
	return viewer.permissions.has(PermissionFlagsBits.Administrator) ||
		viewer.id === owner?.id ||
		(!!owner && !owner.permissions.has(PermissionFlagsBits.Administrator) &&
			archiveRank(viewer, roles) < archiveRank(owner, roles))
}

type Sync = {
	status: ArchiveAccessStatus
	version: number
	force: boolean
	timer?: ReturnType<typeof setTimeout>
	running: boolean
	memberships: Map<string, Set<string>>
	writing?: string
}
const syncs = new WeakMap<Guild, Sync>()

function emptyStatus(state: ArchiveAccessStatus['state']): ArchiveAccessStatus {
	return { state, checked: 0, total: 0, changed: 0, issues: [] }
}

function getArchiveAccessStatus(guild: Guild) {
	if (!store.getSetting('ARCHIVE_MANAGE_ACCESS')) return emptyStatus('off')
	return syncs.get(guild)?.status ?? emptyStatus('queued')
}

async function fetchThreadMembers(thread: ThreadChannel) {
	const ids = new Set<string>()
	let after: string | undefined
	for (;;) {
		const page = await thread.members.fetch({ withMember: true, after, limit: 100, cache: false })
		for (const id of page.keys()) ids.add(id)
		if (page.size < 100) return ids
		const next = page.lastKey()
		if (!next || next === after) throw new Error('Не удалось прочитать состав ветки.')
		after = next
	}
}

async function applyAccess(thread: ThreadChannel, actual: Set<string>, allowed: Set<string>,
	required: Set<string>, current: () => boolean) {
	const remove = [...actual].filter(id => !allowed.has(id))
	const add = [...required].filter(id => !actual.has(id))
	const closeInvites = thread.type === ChannelType.PrivateThread && thread.invitable !== false
	if (!current() || (!remove.length && !add.length && !closeInvites)) return false
	const archived = thread.archived
	if (archived) await thread.setArchived(false, 'Сверка доступа к архиву')
	try {
		if (closeInvites) await thread.setInvitable(false, 'Доступ к архиву зависит от роли')
		for (const id of remove) {
			if (!current()) return true
			await thread.members.remove(id)
			actual.delete(id)
		}
		for (const id of add) {
			if (!current()) return true
			await thread.members.add(id)
			actual.add(id)
		}
	} finally {
		if (archived) await thread.setArchived(true, 'Сверка доступа к архиву завершена')
	}
	return true
}

async function reconcileArchiveAccess(guild: Guild, sync: Sync, version: number, force: boolean) {
	const status = sync.status = emptyStatus('running')
	const current = () => sync.version === version && store.getSetting('ARCHIVE_MANAGE_ACCESS')
	const parentId = store.getSetting('PARENT_CHANNEL_ID')
	if (!parentId) throw new Error('Выберите канал архивов.')
	const parent = guild.channels.cache.get(parentId) ?? await guild.channels.fetch(parentId)
	if (parent?.type !== ChannelType.GuildText) throw new Error('Канал архивов недоступен.')
	const roles = store.roleIds('ARCHIVE_VIEWER_ROLES')
	const members = await loadDiscordMembers(guild, { force })
	const humans = [...members.values()].filter(member => !member.user.bot)
	const visible = humans.filter(member => parent.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
	const bypass = visible.filter(member => !member.permissions.has(PermissionFlagsBits.Administrator) &&
		parent.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads))
	if (bypass.length)
		throw new Error(`У ${bypass.length} участников есть право «Управлять ветками» в канале архивов. Оно открывает все приватные ветки. Уберите право в этом канале и повторите сверку.`)
	const viewers = visible.filter(member => archiveRank(member, roles) < Infinity)
	const admins = humans.filter(member => member.permissions.has(PermissionFlagsBits.Administrator)).map(member => member.id)
	const threads = await getArchiveThreads(guild)
	const owners = await getArchiveOwners(guild, threads)
	const archives = threads.filter(thread => isArchiveThread(thread, owners))
	status.total = archives.size
	for (const id of sync.memberships.keys()) if (!threads.has(id)) sync.memberships.delete(id)
	for (const snapshot of archives.values()) {
		if (!current()) return
		const thread = guild.channels.cache.get(snapshot.id) ?? snapshot
		const ownerId = owners.get(thread.id)
		try {
			if (thread.type !== ChannelType.PrivateThread) throw new Error('Ветка не приватная.')
			if (!ownerId) throw new Error('Владелец не подтверждён или найдено несколько его архивов.')
			const owner = members.get(ownerId)
			const required = new Set<string>()
			if (owner) required.add(ownerId)
			for (const viewer of viewers) {
				if (!viewer.permissions.has(PermissionFlagsBits.Administrator) && canViewArchive(viewer, owner, roles))
					required.add(viewer.id)
			}
			const allowed = new Set([...required, ...admins, guild.client.user.id])
			const actual = sync.memberships.get(thread.id) ?? await fetchThreadMembers(thread)
			sync.memberships.set(thread.id, actual)
			sync.writing = thread.id
			if (await applyAccess(thread, actual, allowed, required, current)) status.changed++
		} catch (error) {
			sync.memberships.delete(thread.id)
			status.issues.push({ threadId: thread.id, message: getError(error).message })
		} finally {
			sync.writing = undefined
			status.checked++
		}
	}
	status.state = status.issues.length ? 'failed' : 'complete'
}

function scheduleArchiveAccess(guild: Guild, force = false) {
	if (!store.ready || !store.getSetting('ARCHIVE_MANAGE_ACCESS')) return
	if (process.env.GUILD_ID && process.env.GUILD_ID !== guild.id) return
	const sync: Sync = syncs.get(guild) ?? {
		status: emptyStatus('queued'), version: 0, force: false, running: false, memberships: new Map()
	}
	syncs.set(guild, sync)
	sync.version++
	sync.force ||= force
	if (sync.timer || sync.running) return
	sync.status = emptyStatus('queued')
	sync.timer = setTimeout(async () => {
		sync.timer = undefined
		if (!store.getSetting('ARCHIVE_MANAGE_ACCESS')) return
		const version = sync.version
		const fresh = sync.force
		sync.force = false
		sync.running = true
		if (fresh) {
			sync.memberships.clear()
			invalidateArchiveInventory(guild)
		}
		try {
			await reconcileArchiveAccess(guild, sync, version, fresh)
		} catch (error) {
			sync.status.state = 'failed'
			sync.status.issues.push({ message: getError(error).message })
			console.error('[Archive access]', getError(error).message)
		} finally {
			sync.running = false
			if (sync.version !== version) scheduleArchiveAccess(guild)
		}
	}, 1500)
	sync.timer.unref()
}

function onArchiveMembershipChange(thread: ThreadChannel, added: Iterable<string>, removed: Iterable<string>) {
	const sync = syncs.get(thread.guild)
	if (!sync || sync.writing === thread.id) return
	const actual = sync.memberships.get(thread.id)
	if (!actual) return
	let changed = false
	for (const id of added) {
		if (actual.has(id)) continue
		actual.add(id)
		changed = true
	}
	for (const id of removed) if (actual.delete(id)) changed = true
	if (changed) scheduleArchiveAccess(thread.guild)
}

export { canViewArchive, getArchiveAccessStatus, onArchiveMembershipChange, scheduleArchiveAccess }
