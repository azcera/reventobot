import { test } from 'node:test'
import assert = require('node:assert/strict')
import type { ButtonInteraction, InteractionEditReplyOptions } from 'discord.js'
import { asMock, moduleStub } from './helpers/moduleStub'

const databasePath = require.resolve('../src/services/database')
let queries = 0
require.cache[databasePath] = moduleStub({ id: databasePath, filename: databasePath, loaded: true,
 exports: { query: async () => { queries++; return { rows: [] } } } })
const { handleModerationButton }: typeof import('../src/features/invite/inviteModeration') = require('../src/features/invite/inviteModeration')

test('reject modal opens before any database request', async () => {
 queries = 0
 let opened = false
 await handleModerationButton(asMock<ButtonInteraction<'cached'>>({ customId: 'invite_reject_user',
  member: { roles: { cache: { some: () => false } }, permissions: { has: () => true } }, showModal: async () => { opened = true } }))
 assert.equal(opened, true)
 assert.equal(queries, 0)
})

test('moderation stops before database changes if acknowledgement fails', async () => {
 queries = 0
 await assert.rejects(handleModerationButton(asMock<ButtonInteraction<'cached'>>({ customId: 'invite_accept_user',
  member: { roles: { cache: { some: () => false } }, permissions: { has: () => true } }, deferReply: async () => { throw new Error('expired interaction') } })), /expired/)
 assert.equal(queries, 0)
})

test('missing application completes the deferred reply without a second acknowledgement', async t => {
 t.mock.method(globalThis, 'setTimeout', asMock<typeof setTimeout>(() => ({ unref() {} })))
 const order: string[] = []
 const event = { customId: 'invite_accept_user', deferred: false,
  member: { roles: { cache: { some: () => false } }, permissions: { has: () => true } },
  deferReply: async () => { order.push('defer'); event.deferred = true },
  reply: async () => assert.fail('must edit the deferred reply'),
  editReply: async (payload: InteractionEditReplyOptions) => { order.push('edit'); assert.match(String(payload.content), /не найдены/) }
 }
 await handleModerationButton(asMock<ButtonInteraction<'cached'>>(event))
 assert.deepEqual(order, ['defer', 'edit'])
})

