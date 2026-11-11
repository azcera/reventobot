import { asMock } from './helpers/moduleStub'
import { moduleStub } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
type ReplyPayload = { content: string }
type ScheduledModal = { custom_id: string; components: { component: { custom_id: string; required: boolean } }[] }

const autoDeletePath = require.resolve('../src/utils/autoDelete')
require.cache[autoDeletePath] = moduleStub({
	id: autoDeletePath, filename: autoDeletePath, loaded: true,
	exports: { sendEphemeralWithAutoDelete: async (interaction: { reply(payload: ReplyPayload): unknown }, payload: ReplyPayload) => interaction.reply(payload) }
})
const groups: typeof import("../src/features/capture/groupInteractions") = require('../src/features/capture/groupInteractions')

function fixture(code = '', allowed = true) {
	const sent: string[] = [], replies: ReplyPayload[] = [], modals: ScheduledModal[] = []
	const interaction = {
		customId: 'schedule_group_stash_1794164400', member: {},
		fields: { getTextInputValue: (key: string) => { assert.equal(key, 'group_code'); return code } },
		client: {
			eventSchedule: {
				canCreateGroup: () => allowed,
				resolveSelection: (id: string) => id === 'stash_1794164400' ? { label: 'Тайники', timestamp: Date.parse('2026-11-08T22:00:00+03:00') } : null
			},
		channels: { cache: new Map([['ping-channel', { isSendable: () => true, send: async (content: string) => sent.push(content) }]]) }
		},
		reply: async (payload: ReplyPayload) => replies.push(payload), showModal: async (modal: { toJSON(): ScheduledModal }) => modals.push(modal.toJSON())
	}
	return { interaction, sent, replies, modals }
}

test('schedule opens only optional code input and preselects the event', async () => {
	const { interaction, modals } = fixture()
	await groups.showScheduledGroupModal(asMock(interaction))
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
			await groups.submitGroupModal(asMock(interaction))
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
	await groups.showScheduledGroupModal(asMock(interaction))
	interaction.customId = 'modal_group_schedule_stash_1794164400'
	await groups.submitGroupModal(asMock(interaction))
	assert.equal(modals.length, 0)
	assert.equal(sent.length, 0)
	assert.equal(replies.length, 2)
})

test('expired or changed event is rejected on submission', async () => {
	const { interaction, sent, replies } = fixture()
	interaction.customId = 'modal_group_schedule_expired_1'
	await groups.submitGroupModal(asMock(interaction))
	assert.equal(sent.length, 0)
	assert.match(replies[0].content, /уже началось/)
})
