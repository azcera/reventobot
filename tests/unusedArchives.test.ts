import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { ChannelType, Collection, MessageType, PermissionFlagsBits, type Guild, type GuildMember, type Message, type ThreadChannel } from 'discord.js'
import { store } from '../src/dashboard/store'
import { cleanupUnusedEmptyArchives, deleteEmptyArchive, fetchArchiveThreads, getUnusedArchives, inspectEmptyArchive } from '../src/features/archive/unusedArchives'
import { getUnusedArchiveLists, handleArchiveCleanup } from '../src/features/archive/archiveCleanupInteractions'
import { loadDiscordMembers } from '../src/services/discordMembers'

const botId = '100000000000000001', ownerId = '100000000000000002', parentId = '100000000000000003'
const threadId = '100000000000000004', otherId = '100000000000000005'

function message(id: string, type = MessageType.Default, authorId = botId, content = '') {
	return { id, type, author: { id: authorId }, content, components: [], attachments: new Collection(), mentions: { users: new Collection() } } as unknown as Message
}
function welcome() { return message('1', MessageType.Default, botId, `## <@${ownerId}>\n### Это твой личный канал-архив`) }
function fixture(history: Message[] = [welcome()]) {
	const members = new Collection<string, GuildMember>()
	const deleted: string[] = [], audits: unknown[] = []
	const client = { user: { id: botId } }
	const guild = { id: 'guild', client, members: { cache: members, fetch: async (options: { user?: string }) => {
		if (!options.user) return members
		if (members.has(options.user)) return members.get(options.user)
		throw Object.assign(new Error('Unknown Member'), { code: 10007 })
	} }, channels: { fetch: async (id: string) => id === parentId ? parent : threads.get(id) } } as unknown as Guild
	const thread = { id: threadId, name: 'archive siriel 123', parentId, client, guild, isThread: () => true,
		messages: { fetch: async ({ limit, before }: { limit: number; before?: string }) => {
			const offset = before ? history.findIndex(message => message.id === before) + 1 : 0
			return new Collection(history.slice(offset, offset + limit).map(message => [message.id, message]))
		} }, delete: async () => { deleted.push(threadId); threads.delete(threadId) } } as unknown as ThreadChannel
	const threads = new Collection([[threadId, thread]])
	const parent = { type: ChannelType.GuildText, threads: {
		fetchActive: async () => ({ threads }), fetchArchived: async () => ({ threads: new Collection(), hasMore: false }) } }
	function addMember(id = ownerId, name = 'Siriel | 123') {
		members.set(id, { id, displayName: name, user: { bot: false } } as GuildMember)
	}
	return { guild, thread, threads, parent, history, members, deleted, audits, addMember }
}

function mockSettings(t: TestContext) {
	t.mock.method(store, 'getSetting', (key: string) => key === 'PARENT_CHANNEL_ID' ? parentId : key === 'ARCHIVE_AUTO_DELETE_EMPTY' ? true : key === 'ROLE_PREFIXES' ? [] : '')
}

test('unused archives consider every member and paginate public and private archives', async t => {
	mockSettings(t)
	const f = fixture()
	f.addMember()
	let privatePages = 0, publicPages = 0
	t.mock.method(f.parent.threads, 'fetchArchived', async ({ type, before }: { type: string; before?: Date }) => {
		if (type === 'private') privatePages++; else publicPages++
		if (before) return { threads: new Collection(), hasMore: false }
		return { threads: new Collection([[type, { id: type, name: `archive ${type} 456`, archiveTimestamp: 100 }]]), hasMore: true }
	})
	const unused = await getUnusedArchives(f.guild)
	assert.deepEqual(unused.map(thread => thread.id).sort(), ['private', 'public'])
	assert.equal(privatePages, 2)
	assert.equal(publicPages, 2)
	Object.assign(f.members.get(ownerId)!, { displayName: 'Siriel | 999' })
	assert.ok((await getUnusedArchives(f.guild, true)).some(thread => thread.id === threadId))
})

test('history inspection allows only one bot welcome and bot rename system messages, across all pages', async t => {
	mockSettings(t)
	const f = fixture(Array.from({ length: 110 }, (_, i) => message(String(120 - i), MessageType.ChannelNameChange)).concat(welcome()))
	assert.equal((await inspectEmptyArchive(f.thread))?.ownerId, ownerId)
	for (const extra of [message('2', MessageType.Default, ownerId, 'Откат'), message('2', MessageType.Default, botId, 'Other bot message'),
		message('2', MessageType.ChannelNameChange, ownerId), message('2', MessageType.ChannelPinnedMessage), welcome()]) {
		Object.assign(extra, { id: '2' })
		assert.equal(await inspectEmptyArchive(fixture([extra, welcome()]).thread), null)
	}
	assert.equal(await inspectEmptyArchive(fixture([]).thread), null)
	assert.equal(await inspectEmptyArchive(fixture([message('1', MessageType.ChannelNameChange)]).thread), null)
	const attached = welcome()
	attached.attachments.set('file', {} as any)
	assert.equal(await inspectEmptyArchive(fixture([attached]).thread), null)
	const join = message('0', MessageType.RecipientAdd)
	join.mentions.users.set(ownerId, { id: ownerId } as any)
	assert.equal((await inspectEmptyArchive(fixture([welcome(), join]).thread))?.ownerId, ownerId)
	const legacy = message('1', MessageType.Default, botId, `<@${ownerId}>, это твой личный канал-архив, куда ты можешь отправлять:`)
	assert.equal((await inspectEmptyArchive(fixture([legacy, join]).thread))?.ownerId, ownerId)
	Object.assign(join, { id: '2' })
	assert.equal(await inspectEmptyArchive(fixture([join, welcome()]).thread), null)
	Object.assign(join, { id: '0' })
	join.mentions.users.clear()
	join.mentions.users.set(otherId, { id: otherId } as any)
	assert.equal(await inspectEmptyArchive(fixture([welcome(), join]).thread), null)
	const componentWelcome = message('1')
	Object.assign(componentWelcome, { components: [{ toJSON: () => ({ type: 17, components: [{ type: 10, content: `## <@${ownerId}>\n### Это твой личный канал-архив` }] }) }] })
	assert.equal((await inspectEmptyArchive(fixture([componentWelcome]).thread))?.ownerId, ownerId)
})

test('automatic deletion requires departed owner, unused identity, enabled setting and unchanged history', async t => {
	mockSettings(t)
	for (const mode of ['empty', 'renamed', 'present', 'new-owner', 'wrong-owner', 'wrong-parent', 'new-message', 'nonempty', 'disabled', 'fetch-failed'] as const) {
		const f = fixture()
		if (mode === 'renamed') f.thread.name = 'archive renamed 456'
		if (mode === 'present') f.addMember(ownerId, 'Bad nickname')
		if (mode === 'new-owner') f.addMember(otherId)
		if (mode === 'wrong-parent') Object.assign(f.thread, { parentId: 'other' })
		if (mode === 'nonempty') f.history.unshift(message('2', MessageType.Default, ownerId, 'Откат'))
		if (mode === 'new-message') {
			const original = f.thread.messages.fetch.bind(f.thread.messages)
			t.mock.method(f.thread.messages, 'fetch', async (options: any) => {
				if (options.limit === 1) return new Collection([['2', message('2', MessageType.Default, ownerId)]])
				return original(options)
			})
		}
		if (mode === 'fetch-failed') t.mock.method(f.guild.members, 'fetch', async () => { throw new Error('Discord unavailable') })
		if (mode === 'disabled') t.mock.method(store, 'getSetting', (key: string) => key === 'PARENT_CHANNEL_ID' ? parentId : key === 'ROLE_PREFIXES' ? [] : false)
		if (mode === 'fetch-failed') await assert.rejects(deleteEmptyArchive(f.thread, ownerId), /Discord unavailable/)
		else assert.equal(await deleteEmptyArchive(f.thread, mode === 'wrong-owner' ? otherId : ownerId), mode === 'empty' || mode === 'renamed', mode)
		assert.equal(f.deleted.length, mode === 'empty' || mode === 'renamed' ? 1 : 0, mode)
		if (mode === 'disabled') mockSettings(t)
	}
})

test('cleanup defaults to preview and preserves archives belonging to present users', async t => {
	mockSettings(t)
	const f = fixture()
	assert.deepEqual((await cleanupUnusedEmptyArchives(f.guild)).empty, [threadId])
	assert.equal(f.deleted.length, 0)
	assert.deepEqual((await cleanupUnusedEmptyArchives(f.guild, true)).deleted, [threadId])
	const current = fixture()
	current.addMember(ownerId, 'Changed nickname')
	assert.deepEqual((await cleanupUnusedEmptyArchives(current.guild, true)).deleted, [])
})

test('unused archive list includes a selection button even when no role matches', async t => {
	mockSettings(t)
	const f = fixture()
	const list = await getUnusedArchiveLists(f.guild)
	assert.equal(list.length, 1)
	assert.match(JSON.stringify(list[0].toJSON()), /Неиспользуемые архивные ветки — 1/)
	assert.match(JSON.stringify(list[0].toJSON()), /archive_cleanup_open_0/)
})

test('fresh member loads share requests and retry gateway rate limits', async t => {
	const f = fixture()
	let requests = 0
	const waits: number[] = []
	t.mock.method(f.guild.members, 'fetch', async () => {
		requests++
		if (requests === 2) throw Object.assign(new Error('Rate limited'), { name: 'GatewayRateLimitError', data: { opcode: 8, retry_after: 1.498 } })
		return f.members
	})
	await loadDiscordMembers(f.guild)
	await loadDiscordMembers(f.guild)
	assert.equal(requests, 1)
	const pending = loadDiscordMembers(f.guild, { force: true, sleep: async ms => { waits.push(ms) } })
	await Promise.all([pending, loadDiscordMembers(f.guild, { force: true })])
	assert.equal(requests, 3)
	assert.deepEqual(waits, [1748])
	await loadDiscordMembers(f.guild)
	assert.equal(requests, 3)
})

test('manual selection is local, authorized, recoverable, and rechecks roster before deleting', async t => {
	mockSettings(t)
	for (const mode of ['delete', 'returned', 'unauthorized', 'other-actor', 'select-all', 'fetch-failed'] as const) {
		const f = fixture([message('2', MessageType.Default, ownerId, 'Saved history'), welcome()])
		const fetchMembers = t.mock.method(f.guild.members, 'fetch', f.guild.members.fetch)
		t.mock.method(store, 'audit', async (...args: unknown[]) => { f.audits.push(args) })
		const replies: any[] = [], edits: any[] = []
		const interaction = { guild: f.guild, guildId: f.guild.id, user: { id: otherId },
			member: { permissions: { has: (permission: bigint) => mode !== 'unauthorized' && permission === PermissionFlagsBits.Administrator }, roles: { cache: new Collection() } },
			customId: 'archive_cleanup_open_0', isButton: () => true, isStringSelectMenu: () => false,
			deferReply: async () => {}, deferUpdate: async () => {}, reply: async (payload: any) => replies.push(payload),
			editReply: async (payload: any) => edits.push(payload) }
		await handleArchiveCleanup(interaction as any)
		if (mode === 'unauthorized') { assert.equal(replies.length, 1); assert.equal(edits.length, 0); continue }
		const selectId = edits[0].components[0].toJSON().components[0].custom_id
		const selection = { ...interaction, customId: selectId, values: [threadId], isButton: () => false, isStringSelectMenu: () => true }
		await handleArchiveCleanup(selection as any)
		assert.equal(fetchMembers.mock.callCount(), 1, 'selecting must not fetch the roster again')
		if (mode === 'select-all') {
			const buttons = edits[1].components[1].toJSON().components
			await handleArchiveCleanup({ ...interaction, customId: buttons[2].custom_id } as any)
			assert.match(edits.at(-1).content, /Выбрано: 0 из 1/)
			assert.equal(edits.at(-1).components[1].toJSON().components[0].disabled, true)
			await handleArchiveCleanup({ ...interaction, customId: buttons[1].custom_id } as any)
			assert.match(edits.at(-1).content, /Выбрано: 1 из 1/)
			assert.equal(fetchMembers.mock.callCount(), 1)
		}
		const deleteId = edits[1].components[1].toJSON().components[0].custom_id
		if (mode === 'returned') f.addMember()
		if (mode === 'other-actor') interaction.user = { id: ownerId }
		if (mode === 'fetch-failed') {
			fetchMembers.mock.mockImplementationOnce(async () => { throw new Error('Discord unavailable') })
			await handleArchiveCleanup({ ...interaction, customId: deleteId } as any)
			assert.equal(f.deleted.length, 0)
			assert.match(edits.at(-1).content, /Ничего не удалено/)
			assert.equal(edits.at(-1).components[1].toJSON().components[0].custom_id, deleteId)
		}
		if (mode === 'delete') await Promise.all([
			handleArchiveCleanup({ ...interaction, customId: deleteId } as any),
			handleArchiveCleanup({ ...interaction, customId: deleteId } as any)
		])
		else await handleArchiveCleanup({ ...interaction, customId: deleteId } as any)
		const shouldDelete = mode === 'delete' || mode === 'select-all' || mode === 'fetch-failed'
		assert.equal(f.deleted.length, shouldDelete ? 1 : 0, mode)
		if (shouldDelete) assert.equal(f.audits.length, 2)
		if (mode === 'delete') assert.equal(fetchMembers.mock.callCount(), 2, 'one fresh roster before deletion')
	}
})
