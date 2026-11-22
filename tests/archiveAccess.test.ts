import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type Guild, type GuildMember, type ThreadChannel } from 'discord.js'
import { store } from '../src/dashboard/store'
import { canViewArchive, getArchiveAccessStatus, scheduleArchiveAccess } from '../src/features/archive/archiveAccess'
import * as archiveThreads from '../src/features/archive/unusedArchives'
import * as identities from '../src/services/memberIdentity'

function member(id: string, roles: string[] = [], administrator = false) {
	return {
		id, user: { bot: false },
		roles: { cache: new Collection(roles.map(role => [role, { id: role }])) },
		permissions: new PermissionsBitField(administrator ? PermissionFlagsBits.Administrator : 0n)
	} as GuildMember
}

test('archive access uses the highest configured role and keeps departed and admin archives private', () => {
	const roles = ['lead', 'checker']
	const owner = member('owner', ['checker'])
	const peer = member('peer', ['checker'])
	const lead = member('lead', ['checker', 'lead'])
	const admin = member('admin', [], true)
	assert.equal(canViewArchive(peer, owner, roles), false)
	assert.equal(canViewArchive(lead, owner, roles), true)
	assert.equal(canViewArchive(owner, owner, roles), true)
	assert.equal(canViewArchive(peer, member('ordinary'), roles), true)
	assert.equal(canViewArchive(lead, undefined, roles), false)
	assert.equal(canViewArchive(lead, admin, roles), false)
	assert.equal(canViewArchive(admin, owner, roles), true)
})

test('background sync removes stale access, restores archive state and reuses membership on role changes', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	t.mock.getter(store, 'ready', () => true)
	t.mock.method(store, 'getSetting', (key: string) => key === 'ARCHIVE_MANAGE_ACCESS' ? true : 'parent')
	t.mock.method(store, 'roleIds', () => ['lead', 'checker'])
	const owner = member('owner', ['checker'])
	const peer = member('peer', ['checker'])
	const lead = member('lead', ['lead'])
	const roster = new Collection([owner, peer, lead].map(entry => [entry.id, entry]))
	const requests: string[] = []
	const thread = {
		id: 'thread', type: ChannelType.PrivateThread, archived: true, invitable: true,
		async setArchived(value: boolean) { requests.push(`archived:${value}`); thread.archived = value },
		async setInvitable(value: boolean) { requests.push(`invitable:${value}`); thread.invitable = value },
		members: {
			async fetch() { requests.push('fetch'); return new Collection([['bot', {}], ['owner', {}], ['peer', {}]]) },
			async add(id: string) { requests.push(`add:${id}`) },
			async remove(id: string) { requests.push(`remove:${id}`) }
		}
	}
	let broadAccess = false
	const parent = {
		type: ChannelType.GuildText,
		permissionsFor: () => new PermissionsBitField(broadAccess
			? PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageThreads : PermissionFlagsBits.ViewChannel)
	}
	const guild = {
		id: 'guild', client: { user: { id: 'bot' } },
		channels: { cache: new Collection<string, typeof parent | typeof thread>([['parent', parent], ['thread', thread]]) },
		members: { cache: roster, fetch: async () => roster }
	} as unknown as Guild
	t.mock.method(archiveThreads, 'getArchiveThreads', async () => new Collection([['thread', thread as unknown as ThreadChannel]]))
	t.mock.method(archiveThreads, 'getArchiveOwners', async () => new Map([['thread', 'owner']]))
	async function sync() {
		scheduleArchiveAccess(guild)
		t.mock.timers.tick(1500)
		await setImmediate()
		return getArchiveAccessStatus(guild)
	}
	assert.equal((await sync()).state, 'complete')
	assert.deepEqual(requests, ['fetch', 'archived:false', 'invitable:false', 'remove:peer', 'add:lead', 'archived:true'])
	requests.length = 0
	assert.equal((await sync()).changed, 0)
	assert.deepEqual(requests, [])
	lead.roles.cache.clear()
	assert.equal((await sync()).changed, 1)
	assert.deepEqual(requests, ['archived:false', 'remove:lead', 'archived:true'])
	requests.length = 0
	broadAccess = true
	const blocked = await sync()
	assert.equal(blocked.state, 'failed')
	assert.match(blocked.issues[0].message, /Управлять ветками/)
	assert.deepEqual(requests, [])
})

test('legacy migration links an unambiguous bot welcome once and leaves duplicate owners unresolved', async t => {
	const records: Awaited<ReturnType<typeof identities.getMemberArchives>> = []
	t.mock.method(identities, 'getMemberArchives', async () => records)
	t.mock.method(identities, 'getMemberIdentity', async () => undefined)
	t.mock.method(identities, 'withMemberArchiveLock', async (_guild: string, _owner: string, work: (db: unknown) => Promise<unknown>) => work({}))
	const link = t.mock.method(identities, 'linkMemberArchive', async (_guild: string, owner: string, thread: string, gameStatic: string) => {
		records.push({ discord_id: owner, archive_thread_id: thread, game_static: gameStatic })
		return true
	})
	const guild = { id: 'guild' } as Guild
	const bot = { id: 'bot', bot: true }
	function legacy(id: string, owner: string, gameStatic: string) {
		const message = { id: 'welcome', author: bot, type: 0, attachments: new Collection(), components: [],
			content: `<@${owner}>, это твой личный канал-архив` }
		return { id, guild, name: `archive legacy ${gameStatic}`, lastMessageId: 'welcome', client: { user: bot },
			messages: { fetch: async () => new Collection([[message.id, message]]) } } as unknown as ThreadChannel
	}
	const unique = '100000000000000001'
	const duplicate = '100000000000000002'
	const threads = new Collection([legacy('one', unique, '21'), legacy('two', duplicate, '42'), legacy('three', duplicate, '42')]
		.map(thread => [thread.id, thread]))
	assert.deepEqual(await archiveThreads.getArchiveOwners(guild, threads), new Map([['one', unique]]))
	assert.deepEqual(await archiveThreads.getArchiveOwners(guild, threads), new Map([['one', unique]]))
	assert.equal(link.mock.callCount(), 1)
	assert.equal(records[0].game_static, '21')
})
