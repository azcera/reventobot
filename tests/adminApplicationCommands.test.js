const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js')

const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } }
const autoDeletePath = require.resolve('../src/utils/autoDelete')
require.cache[autoDeletePath] = { id: autoDeletePath, filename: autoDeletePath, loaded: true, exports: {
	sendEphemeralWithAutoDelete: (interaction, payload) => interaction.reply(payload),
	editReplyWithAutoDelete: (interaction, payload) => interaction.editReply(payload),
	replyWithAutoDelete: (interaction, payload) => interaction.reply(payload),
	followUpEphemeralWithAutoDelete: (interaction, payload) => interaction.followUp(payload)
} }
const { registerAdminApplicationCommands } = require('../src/services/adminApplicationCommands')
const { store: dashboard } = require('../src/dashboard/store')

function fixture() {
	const registered = [], replies = [], modals = [], moved = []
	const store = { roleIds: () => ['admin-role'], getSetting: () => assert.fail('obsolete panel setting requested') }
	const target = { id: 'target', type: ChannelType.GuildVoice, name: '🔊 Общий', members: new Collection() }
	const source = { id: 'source', type: ChannelType.GuildVoice, name: '🔊 Другой', members: new Collection([
		['person', { voice: { setChannel: async channel => moved.push(channel.id) } }]
	]) }
	const guild = { id: 'guild', commands: { create: async data => registered.push(data) },
		members: { me: { permissions: { has: () => true } } },
		channels: { fetch: async () => assert.fail('obsolete panel channel requested'), cache: new Collection([[target.id, target], [source.id, source]]) } }
	let listener
	const client = { user: { id: 'bot' }, commands: new Collection([['unrelated', { name: 'unrelated' }]]), on: (event, callback) => { listener = callback } }
	function interaction(commandName, kind = 'command') {
		return { commandName, guild, member: { permissions: { has: flag => flag === PermissionFlagsBits.Administrator }, roles: { cache: new Collection() } },
			user: { id: 'admin' }, client,
			isChatInputCommand: () => kind === 'command', isButton: () => kind === 'button',
			isUserContextMenuCommand: () => kind === 'context',
			isModalSubmit: () => kind === 'modal', isStringSelectMenu: () => kind === 'select',
			showModal: async modal => modals.push(modal.toJSON()), deferReply: async () => {},
			reply: async payload => replies.push(payload), editReply: async payload => replies.push(payload) }
	}
	return { client, guild, store, registered, replies, modals, moved, interaction,
		async register() { await registerAdminApplicationCommands(client, guild, store) },
		listen() { require('../src/events/interactionCreate')(client); return event => listener(event) } }
}

test('registers slash and user commands without replacing other commands or accessing the deleted panel', async () => {
	const f = fixture()
	await f.register()
	assert.deepEqual(f.registered.map(command => command.name), ['capt', 'group', 'move-all', 'Создать архив', 'Открыть архив'])
	assert.deepEqual(f.registered.slice(-2).map(command => command.type), [2, 2])
	assert.ok(f.client.commands.has('unrelated'))
})

test('commands open existing capture modal, direct three-field group modal and voice channel selector', async () => {
	const f = fixture()
	await f.register()
	const handle = f.listen()
	await handle(f.interaction('capt'))
	await handle(f.interaction('group'))
	await handle(f.interaction('move-all'))
	assert.equal(f.modals[0].custom_id, 'modal_capt')
	assert.equal(f.modals[1].custom_id, 'modal_group_other')
	assert.deepEqual(f.modals[1].components.map(label => label.component.custom_id), ['group_time', 'group_target', 'group_code'])
	assert.equal(f.modals[1].components[2].component.required, false)
	assert.equal(f.replies[0].components[0].toJSON().components[0].custom_id, 'move_all_channel')
})

test('commands deny ordinary members and DMs but permit configured ADMIN_ROLES', async () => {
	const f = fixture()
	await f.register()
	for (const name of ['capt', 'group', 'move-all', 'Создать архив', 'Открыть архив']) {
		const event = f.interaction(name)
		event.member.permissions.has = () => false
		await f.client.commands.get(name).execute(event)
		assert.equal(f.replies.at(-1).flags, MessageFlags.Ephemeral)
		assert.match(f.replies.at(-1).content, /только администраторам/)
	}
	assert.equal(f.modals.length, 0)
	const dm = f.interaction('capt'); dm.guild = null
	await f.client.commands.get('capt').execute(dm)
	assert.equal(f.modals.length, 0)
	const roleAdmin = f.interaction('group')
	roleAdmin.member.permissions.has = () => false
	roleAdmin.member.roles.cache.set('admin-role', { id: 'admin-role' })
	await f.client.commands.get('group').execute(roleAdmin)
	assert.equal(f.modals.length, 1)
})

test('permission is rechecked on form submission and voice selection after command invocation', async () => {
	const f = fixture()
	await f.register()
	const handle = f.listen()
	for (const [kind, customId] of [['modal', 'modal_capt'], ['modal', 'modal_group_other'], ['select', 'move_all_channel']]) {
		const event = f.interaction(null, kind)
		event.customId = customId
		event.member.permissions.has = () => false
		await handle(event)
		assert.match(f.replies.at(-1).content, /только администраторам/)
	}
	assert.deepEqual(f.moved, [])
})

test('voice command selection moves members using the existing handler', async () => {
	const f = fixture()
	await f.register()
	const event = f.interaction(null, 'select')
	event.customId = 'move_all_channel'; event.values = ['target']
	await f.listen()(event)
	assert.deepEqual(f.moved, ['target'])
	assert.match(f.replies[0].content, /перемещено участников: \*\*1\*\*/)
})

test('legacy group button also opens the direct group form', async () => {
	const f = fixture()
	const event = f.interaction(null, 'button'); event.customId = 'group'
	await f.listen()(event)
	assert.equal(f.modals[0].custom_id, 'modal_group_other')
	assert.equal(f.modals[0].components.length, 3)
})

test('manual group form submits time, target and optional code with existing announcement timings', async () => {
	const f = fixture(), sent = []
	const event = f.interaction(null, 'modal'); event.customId = 'modal_group_other'
	event.fields = { getTextInputValue: key => ({ group_time: '08.11.2026 18:00', group_target: 'ОГРАБЛЕНИЯ', group_code: 'ABC' })[key] }
	event.client.channels = { cache: new Collection([['ping', { send: async content => sent.push(content) }]]) }
	const previous = process.env.PING_CHANNEL_ID
	process.env.PING_CHANNEL_ID = 'ping'
	try { await f.listen()(event) }
	finally { if (previous === undefined) delete process.env.PING_CHANNEL_ID; else process.env.PING_CHANNEL_ID = previous }
	assert.equal(sent.length, 3)
	assert.match(sent[0], /ОГРАБЛЕНИЯ.*17:50.*17:55.*ABC/)
})

test('prefix messages do not invoke application command handlers', async () => {
	const f = fixture()
	await f.register()
	let listener
	f.client.on = (event, callback) => { listener = callback }
	require('../src/events/messageCreate')(f.client)
	await listener({ author: { bot: false }, channel: { isThread: () => false }, content: '!capt' })
	assert.equal(f.modals.length, 0)
})

function archiveFixture() {
	const f = fixture(), created = [], added = [], sent = [], archivedRequests = []
	f.guild.channels.cache.clear()
	const parentId = dashboard.getSetting('PARENT_CHANNEL_ID')
	const member = { id: 'target-member', displayName: '[Admin] Name | 12345', user: { tag: 'target' } }
	const thread = { id: 'archive-thread', parentId, name: 'archive name 12345', isThread: () => true,
		members: { add: async id => added.push(id) }, send: async payload => { sent.push(payload) } }
	const pages = []
	const parent = { id: parentId, type: ChannelType.GuildText, isThread: () => false, threads: {
		fetchActive: async () => ({ threads: new Collection() }),
		fetchArchived: async options => { archivedRequests.push(options); return pages.shift() || { threads: new Collection(), hasMore: false } },
		create: async options => { created.push(options); f.guild.channels.cache.set(thread.id, thread); return thread }
	} }
	f.guild.channels.cache.set(parentId, parent)
	f.guild.members.fetch = async id => { assert.equal(id, member.id); return member }
	const event = f.interaction('Создать архив', 'context')
	event.targetId = member.id
	event.deferReply = async payload => { event.deferred = true; assert.equal(payload.flags, MessageFlags.Ephemeral) }
	return { ...f, member, thread, parent, pages, event, created, added, sent, archivedRequests }
}

test('user context command creates the selected member archive with existing private thread and navigation logic', async () => {
	const f = archiveFixture()
	await f.register()
	await f.listen()(f.event)
	assert.equal(f.created.length, 1)
	assert.equal(f.created[0].name, 'archive name 12345')
	assert.equal(f.created[0].type, ChannelType.PrivateThread)
	assert.deepEqual(f.added, ['target-member'])
	assert.match(f.sent[0].components[0].toJSON().components[0].content, /target-member/)
	assert.match(f.replies[0].content, /создана успешно/)
})

test('invalid nickname and duplicate archive show modals without creating a thread', async () => {
	const { handleArchiveCommand } = require('../src/features/archive/archiveContextCommands')
	const f = archiveFixture()
	f.member.displayName = 'invalid'
	await handleArchiveCommand(f.event)
	assert.match(f.modals.at(-1).components[0].content, /Ник участника не по форме/)
	f.member.displayName = 'Name | 12345'
	f.guild.channels.cache.set(f.thread.id, f.thread)
	await handleArchiveCommand(f.event)
	assert.match(f.modals.at(-1).components[0].content, /Архив уже создан/)
	assert.equal(f.created.length, 0)
})

test('search finds uncached archived threads across pages and prevents duplicate creation', async () => {
	const f = archiveFixture()
	const other = { ...f.thread, name: 'archive other 999', archiveTimestamp: 1000 }
	f.pages.push({ threads: new Collection([['other', other]]), hasMore: true },
		{ threads: new Collection([[f.thread.id, f.thread]]), hasMore: false })
	await require('../src/features/archive/archiveContextCommands').handleArchiveCommand(f.event)
	assert.equal(f.archivedRequests.length, 2)
	assert.equal(f.archivedRequests[1].before, 1000)
	assert.match(f.modals[0].components[0].content, /Архив уже создан/)
	assert.equal(f.created.length, 0)
})

test('open archive returns a channel link for the selected member or a not-found modal', async () => {
	const { handleArchiveCommand } = require('../src/features/archive/archiveContextCommands')
	const f = archiveFixture()
	f.event.commandName = 'Открыть архив'
	await handleArchiveCommand(f.event)
	assert.match(f.modals[0].components[0].content, /архив не найден/)
	f.guild.channels.cache.set(f.thread.id, f.thread)
	f.thread.archived = true
	f.thread.setArchived = async archived => { f.thread.archived = archived }
	await handleArchiveCommand(f.event)
	assert.equal(f.replies[0].components[0].toJSON().components[0].url, 'https://discord.com/channels/guild/archive-thread')
	assert.equal(f.thread.archived, false)
	assert.deepEqual(f.added, ['admin'])
	assert.equal(f.created.length, 0)
})

test('simultaneous create commands create only one archive and release the lock', async () => {
	const { handleArchiveCommand } = require('../src/features/archive/archiveContextCommands')
	const f = archiveFixture()
	let release
	f.parent.threads.fetchActive = () => new Promise(resolve => { release = resolve })
	const first = handleArchiveCommand(f.event)
	await new Promise(resolve => setImmediate(resolve))
	await handleArchiveCommand(f.event)
	assert.match(f.modals[0].components[0].content, /уже обрабатывается/)
	release({ threads: new Collection() })
	await first
	await handleArchiveCommand(f.event)
	assert.equal(f.created.length, 1)
	assert.match(f.modals.at(-1).components[0].content, /Архив уже создан/)
})

test('archive notification and legacy creation buttons deny ordinary members', async () => {
	const f = fixture(), handle = f.listen()
	for (const [kind, customId] of [['button', 'archive_show_notice'], ['modal', 'archive_notice'],
		['button', 'create_archive-name-123-123456789012345678'], ['button', 'cancel_create_archive-name-123-123456789012345678']]) {
		const event = f.interaction(null, kind)
		event.customId = customId
		event.member.permissions.has = () => false
		await handle(event)
		assert.match(f.replies.at(-1).content, /только администраторам/)
	}
})

test('slow archive lookup acknowledges on time and offers a notification modal button', async () => {
	const f = archiveFixture()
	f.parent.threads.fetchActive = async () => {
		await new Promise(resolve => setTimeout(resolve, 1900))
		return { threads: new Collection([[f.thread.id, f.thread]]) }
	}
	await require('../src/features/archive/archiveContextCommands').handleArchiveCommand(f.event)
	assert.equal(f.event.deferred, true)
	assert.match(f.replies[0].content, /Архив уже создан/)
	const button = f.interaction(null, 'button')
	button.customId = f.replies[0].components[0].toJSON().components[0].custom_id
	button.message = { content: f.replies[0].content }
	await f.listen()(button)
	assert.match(f.modals[0].components[0].content, /Архив уже создан/)
})

test('command errors with expired interactions do not attempt a second response', async () => {
	const f = fixture(), handle = f.listen(), event = f.interaction('capt')
	f.client.commands.set('capt', { execute: async () => { throw Object.assign(new Error('expired'), { code: 10062 }) } })
	await handle(event)
	assert.deepEqual(f.replies, [])
})

test('other command errors still receive the ephemeral error response', async () => {
	const f = fixture(), handle = f.listen(), event = f.interaction('capt')
	f.client.commands.set('capt', { execute: async () => { throw Object.assign(new Error('failure'), { code: 'OTHER' }) } })
	await handle(event)
	assert.equal(f.replies.length, 1)
	assert.match(f.replies[0].content, /ошибка при запуске команды/i)
})

test('other command errors still use a follow-up after the interaction was deferred', async () => {
	const f = fixture(), handle = f.listen(), event = f.interaction('capt')
	event.deferred = true
	event.followUp = async payload => f.replies.push(payload)
	f.client.commands.set('capt', { execute: async () => { throw new Error('failure') } })
	await handle(event)
	assert.equal(f.replies.length, 1)
	assert.match(f.replies[0].content, /ошибка при запуске команды/i)
})

test('other command errors do not reply after the interaction response window expired', async () => {
	const f = fixture(), handle = f.listen(), event = f.interaction('capt')
	event.createdTimestamp = Date.now() - 4000
	f.client.commands.set('capt', { execute: async () => { throw new Error('late failure') } })
	await handle(event)
	assert.deepEqual(f.replies, [])
})
