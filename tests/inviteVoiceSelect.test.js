const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Collection, ChannelType } = require('discord.js')

let rows = [{}]
let allowed = true
let queries = 0
function stub(path, exports) {
	const id = require.resolve(path)
	require.cache[id] = { id, filename: id, loaded: true, exports }
}
stub('../src/services/database', {
	query: async () => {
		queries++
		return { rows }
	}
})
stub('../src/features/invite/inviteUtils', {
	isApplicationMod: () => allowed,
	buildContainer: async () => ({ toJSON: () => ({}) }),
	logAction: async () => {}
})
stub('../src/utils/autoDelete', {
	editReplyWithAutoDelete: async (interaction, options) => {
		assert.equal(interaction.deferred, true, 'reply must be acknowledged first')
		return interaction.editReply(options)
	}
})
const { handleModerationButton } = require('../src/features/invite/inviteModeration')
const { handleVoiceSelect } = require('../src/features/invite/inviteVoiceSelect')

function selection(deferReply) {
	return {
		customId: 'invite_select_voice_123',
		values: ['456'],
		user: { id: 'admin' },
		guild: { name: 'Test' },
		channel: { send: async () => {} },
		client: { users: { fetch: async () => null } },
		deferred: false,
		deferReply,
		editReply: async function (options) {
			assert.equal(this.deferred, true)
			this.response = options.content
		}
	}
}

test('collector does not edit the selection while Discord acknowledgement is pending', async () => {
	const handlers = {}
	let menuDeleted = false
	const button = {
		customId: 'invite_interview_123',
		user: { id: 'admin' },
		guild: {
			channels: {
				cache: new Collection([['456', { id: '456', type: ChannelType.GuildVoice, name: '📞 Room' }]])
			}
		},
		message: { edit: async () => {} },
		channel: {
			createMessageComponentCollector: () => ({
				on: (event, handler) => { handlers[event] = handler }
			})
		},
		deferReply: async function () { this.deferred = true },
		editReply: async () => {},
		deleteReply: async () => { menuDeleted = true }
	}
	await handleModerationButton(button)
	let acknowledge
	const interaction = selection(async function () {
		await new Promise(resolve => { acknowledge = resolve })
		this.deferred = true
	})
	const pending = handleVoiceSelect(interaction)
	await handlers.collect(interaction)
	assert.equal(interaction.response, undefined)
	assert.equal(menuDeleted, true)
	acknowledge()
	await pending
	assert.match(interaction.response, /Кандидат успешно вызван/)
})

test('denied and missing applications complete the deferred reply', async () => {
	for (const scenario of [
		{ allowed: false, rows: [{}], expected: /Недостаточно прав/ },
		{ allowed: true, rows: [], expected: /Заявка не найдена/ }
	]) {
		allowed = scenario.allowed
		rows = scenario.rows
		const interaction = selection(async function () { this.deferred = true })
		await handleVoiceSelect(interaction)
		assert.match(interaction.response, scenario.expected)
	}
	allowed = true
	rows = [{}]
})

test('failed acknowledgement stops processing the selection', async () => {
	const before = queries
	const interaction = selection(async () => { throw new Error('expired interaction') })
	const originalError = console.error
	const errors = []
	console.error = (...args) => errors.push(args)
	try {
		await handleVoiceSelect(interaction)
	} finally {
		console.error = originalError
	}
	assert.equal(queries, before)
	assert.equal(interaction.response, undefined)
	assert.equal(errors.length, 1)
})
