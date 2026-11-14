import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContainerBuilder, MessageFlagsBitField, TextDisplayBuilder } from 'discord.js'
import { applyFields } from '../src/dashboard/messageEditor'
import { buildEditPayload } from '../src/services/containerMessageService'
import type { MessageShape } from '../src/types'

const text = 'Объявление @everyone <@&123456789012345678>'

test('editing message fields preserves everyone and role mentions without changing other content', () => {
	const message: MessageShape = {
		components: [new ContainerBuilder().addTextDisplayComponents(
			new TextDisplayBuilder().setContent('Старый текст'), new TextDisplayBuilder().setContent('Без изменений')
		)],
		flags: new MessageFlagsBitField('IsComponentsV2'), content: '', embeds: [], attachments: new Map()
	}
	const payload = applyFields(message, { 'components.0.components.0.content': text })
	assert.equal(payload.components[0].components?.[0].content, text)
	assert.equal(payload.components[0].components?.[1].content, 'Без изменений')
	assert.ok(payload.allowedMentions.parse?.includes('everyone'))
	assert.ok(payload.allowedMentions.parse?.includes('roles'))
	assert.equal(payload.allowedMentions.repliedUser, false)
})

test('editing a container preserves everyone and role mentions alongside its text', () => {
	const payload = buildEditPayload({ items: [{ type: 'text', value: text }] })
	assert.equal(payload.components[0].toJSON().components[0].type, 10)
	assert.match(JSON.stringify(payload.components), /@everyone/)
	assert.ok(payload.allowedMentions?.parse?.includes('everyone'))
	assert.ok(payload.allowedMentions?.parse?.includes('roles'))
})
