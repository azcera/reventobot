const { test } = require('node:test')
const assert = require('node:assert/strict')

const autoDeletePath = require.resolve('../src/utils/autoDelete')
require.cache[autoDeletePath] = {
	id: autoDeletePath, filename: autoDeletePath, loaded: true,
	exports: { sendEphemeralWithAutoDelete: async (interaction, payload) => interaction.reply(payload) }
}
const groups = require('../src/features/capture/groupInteractions')

function fixture(code = '', allowed = true) {
	const sent = [], replies = [], modals = []
	const interaction = {
		customId: 'schedule_group_stash_1794164400', member: {},
		fields: { getTextInputValue: key => { assert.equal(key, 'group_code'); return code } },
		client: {
			eventSchedule: {
				canCreateGroup: () => allowed,
				resolveSelection: id => id === 'stash_1794164400' ? { label: 'Тайники', timestamp: Date.parse('2026-11-08T22:00:00+03:00') } : null
			},
			channels: { cache: new Map([['ping-channel', { send: async content => sent.push(content) }]]) }
		},
		reply: async payload => replies.push(payload), showModal: async modal => modals.push(modal.toJSON())
	}
	return { interaction, sent, replies, modals }
}

test('schedule opens only optional code input and preselects the event', async () => {
	const { interaction, modals } = fixture()
	await groups.showScheduledGroupModal(interaction)
	assert.equal(modals[0].custom_id, 'modal_group_schedule_stash_1794164400')
	assert.equal(modals[0].components.length, 1)
	assert.equal(modals[0].components[0].component.custom_id, 'group_code')
	assert.equal(modals[0].components[0].component.required, false)
})

test('empty code omits both key and code line; filled code keeps existing announcement and timings', async () => {
	const previous = process.env.PING_CHANNEL_ID
	process.env.PING_CHANNEL_ID = 'ping-channel'
	try {
		for (const code of ['', '   ', ' ABC123 ']) {
			const { interaction, sent, replies } = fixture(code)
			interaction.customId = 'modal_group_schedule_stash_1794164400'
			await groups.submitGroupModal(interaction)
			assert.equal(sent.length, 3)
			assert.match(sent[0], /ТАЙНИКИ.*21:50.*21:55/)
			if (code.trim()) {
				assert.match(sent[0], /🔑 Код группы: `ABC123`/)
			} else {
				assert.doesNotMatch(sent[0], /🔑|Код группы/)
				assert.doesNotMatch(replies[0].content, /Код:/)
			}
		}
	} finally {
		if (previous === undefined) delete process.env.PING_CHANNEL_ID
		else process.env.PING_CHANNEL_ID = previous
	}
})

test('regular members denied on both button click and modal submission', async () => {
	const { interaction, modals, sent, replies } = fixture('', false)
	await groups.showScheduledGroupModal(interaction)
	interaction.customId = 'modal_group_schedule_stash_1794164400'
	await groups.submitGroupModal(interaction)
	assert.equal(modals.length, 0)
	assert.equal(sent.length, 0)
	assert.equal(replies.length, 2)
})

test('expired or changed event is rejected on submission', async () => {
	const { interaction, sent, replies } = fixture()
	interaction.customId = 'modal_group_schedule_expired_1'
	await groups.submitGroupModal(interaction)
	assert.equal(sent.length, 0)
	assert.match(replies[0].content, /уже началось/)
})
