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
const { registerAdminApplicationCommands, stripPanelActions } = require('../src/services/adminApplicationCommands')
const { store: dashboard } = require('../src/dashboard/store')

function fixture() {
	const registered = [], edited = [], replies = [], modals = [], moved = []
	const store = { roleIds: () => ['admin-role'], getSetting: () => 'panel-channel' }
	const button = id => ({ type: 2, style: 1, label: id, custom_id: id })
	const section = id => ({ type: 9, components: [{ type: 10, content: id }], accessory: button(id) })
	const panel = { type: 17, components: [
		{ type: 10, content: 'Панель' }, ...['capt', 'group', 'move-all', 'keep'].map(section),
		{ type: 1, components: [button('capt'), button('keep-row')] }
	] }
	const message = { author: { id: 'bot' }, components: [{ toJSON: () => panel }], edit: async payload => edited.push(payload) }
	const messages = new Collection([['panel', message], ['foreign', { ...message, author: { id: 'other' }, edit: () => assert.fail('foreign message changed') }]])
	const target = { id: 'target', type: ChannelType.GuildVoice, name: '🔊 Общий', members: new Collection() }
	const source = { id: 'source', type: ChannelType.GuildVoice, name: '🔊 Другой', members: new Collection([
		['person', { voice: { setChannel: async channel => moved.push(channel.id) } }]
	]) }
	const guild = { id: 'guild', commands: { create: async data => registered.push(data) },
		members: { me: { permissions: { has: () => true } } },
		channels: { fetch: async () => ({ messages: { fetch: async () => messages } }), cache: new Collection([[target.id, target], [source.id, source]]) } }
	let listener
	const client = { user: { id: 'bot' }, commands: new Collection([['unrelated', { name: 'unrelated' }]]), on: (event, callback) => { listener = callback } }
	function interaction(commandName, kind = 'command') {
		return { commandName, guild, member: { permissions: { has: flag => flag === PermissionFlagsBits.Administrator }, roles: { cache: new Collection() } },
			user: { id: 'admin' }, client,
			isChatInputCommand: () => kind === 'command', isButton: () => kind === 'button',
			isModalSubmit: () => kind === 'modal', isStringSelectMenu: () => kind === 'select',
			showModal: async modal => modals.push(modal.toJSON()), deferReply: async () => {},
			reply: async payload => replies.push(payload), editReply: async payload => replies.push(payload) }
	}
	return { client, guild, store, registered, edited, replies, modals, moved, panel, message, interaction,
		async register() { await registerAdminApplicationCommands(client, guild, store) },
		listen() { require('../src/events/interactionCreate')(client); return event => listener(event) } }
}

test('registers three guild commands without replacing other commands and removes panel buttons', async () => {
	const f = fixture()
	await f.register()
	assert.deepEqual(f.registered.map(command => command.name), ['capt', 'group', 'move-all'])
	assert.ok(f.client.commands.has('unrelated'))
	assert.equal(f.edited.length, 1)
	const after = f.edited[0].components[0]
	assert.deepEqual(after.components.filter(component => component.accessory).map(component => component.accessory.custom_id), ['keep'])
	assert.deepEqual(after.components.at(-1).components.map(component => component.custom_id), ['keep-row'])
	assert.equal(f.panel.components.length, 6, 'input panel is not mutated')
	assert.deepEqual(stripPanelActions(after), after, 'removal is idempotent')
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
	for (const name of ['capt', 'group', 'move-all']) {
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
