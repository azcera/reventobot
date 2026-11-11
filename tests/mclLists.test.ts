import { asMock } from './helpers/moduleStub'
import type { MclList, RawComponent } from '../src/types'
import type { Guild, Client } from 'discord.js'
interface TestComponent extends RawComponent { components: TestComponent[]; accessory: TestComponent; options: { value: string }[] }
interface Payload { content: string; flags?: number; allowedMentions?: import('discord.js').MessageMentionOptions; components: { toJSON(): TestComponent }[] }
import test = require('node:test')
import assert = require('node:assert/strict')
import { Collection, MessageFlags } from 'discord.js'
import { createMclLists as originalCreateMclLists, validateLists as originalValidateLists } from '../src/services/mclLists'
const createMclLists = (options: unknown) => originalCreateMclLists(asMock<Parameters<typeof originalCreateMclLists>[0]>(options))
const validateLists = (lists: MclList[], guild: unknown) => originalValidateLists(lists, asMock<Guild>(guild))

const id = '00000000-0000-4000-8000-000000000001'
const list = { id, channelId: 'channel', roleId: 'role', accessRoleId: '', title: 'Игроки', addName: 'Добавить игрока', removeName: 'Убрать игрока' }
function fixture() {
 let memberFetches = 0, syncPasses = 0
 const sent: Payload[] = [], edits: Payload[] = []
 const message = { id: 'message', content: 'Прежнее сообщение', author: { id: 'bot' }, edit: async (payload: Payload) => { edits.push(payload); message.content = payload.content || '' }, delete: async () => {} }
 const channel = { type: 0, isTextBased: () => true, messages: { fetch: async () => message }, send: async (payload: Payload) => { sent.push(payload); return message } }
 const members = new Collection([['1', { id: '1', roles: { cache: new Collection([['role', {}]]) } }]])
 const commands = new Collection<string, { name: string; delete: () => Promise<boolean> }>()
 const guild = { id: 'guild', roles: { cache: new Collection([['role', {}]]) }, channels: { cache: new Collection([['channel', channel]]), fetch: async () => channel }, members: { cache: members, fetch: (async () => { memberFetches++; return members }) as (options?: { user: string; force?: boolean }) => Promise<unknown> }, commands: { fetch: async () => commands, create: async (data: { name: string }) => { commands.set(data.name, { ...data, delete: async () => commands.delete(data.name) }) } } }
 const state = { mclLists: {} as Record<string, MclList>, revision: 0, async save(section: string, values: Record<string, MclList | null>) { this.mclLists = Object.fromEntries(Object.entries(values).filter((pair): pair is [string, MclList] => Boolean(pair[1]))); this.revision++ }, roleIds: () => [] }
 const rows: { commands: string[]; messages: { channel_id: string; message_id: string }[] } = { commands: [], messages: [] }
 const pool = { async query(sql: string, args: string[]) {
  if (sql.startsWith('SELECT name')) return { rows: rows.commands.map(name => ({ name })) }
  if (sql.startsWith('SELECT channel_id')) { syncPasses++; return { rows: rows.messages } }
  if (sql.startsWith('INSERT INTO mcl_commands')) rows.commands.push(args[1])
  if (sql.startsWith('INSERT INTO mcl_messages')) rows.messages = [{ channel_id: args[1], message_id: args[2] }]
  return { rows: [] }
 } }
 const client = { commands: new Collection<string, { execute(interaction: unknown): Promise<unknown> }>(), user: { id: 'bot' } }
 return { guild, state, sent, edits, client, get memberFetches() { return memberFetches }, get syncPasses() { return syncPasses }, service: createMclLists({ client, pool, store: state }) }
}
test('публикация объединяет списки и повторно обновляет сообщение', async () => {
 const f = fixture()
 const other = { ...list, id: '00000000-0000-4000-8000-000000000002', title: 'Вторая группа', addName: 'Добавить второго', removeName: 'Убрать второго' }
 await f.service.save(asMock<Guild>(f.guild), [list, other], 0, { id: 'admin' })
 assert.equal(f.sent.length, 1)
 const components = f.sent[0].components[0].toJSON().components
 assert.match(components[0].content!, /### Игроки\n- <@1>/)
 assert.deepEqual(components[1].components.map(button => button.custom_id), [`mcl_add_${id}`, `mcl_remove_${id}`])
 assert.match(components[2].content!, /### Вторая группа\n- <@1>/)
 assert.deepEqual(components[3].components.map(button => button.custom_id), [`mcl_add_${other.id}`, `mcl_remove_${other.id}`])
 assert.equal(f.sent[0].flags, MessageFlags.IsComponentsV2)
 assert.equal(components.length, 4)
 assert.deepEqual(f.sent[0].allowedMentions, { parse: [] })
 await f.service.sync(asMock<Guild>(f.guild), true)
 assert.equal(f.edits.length, 1)
 assert.equal(f.edits[0].content, null)
 assert.equal(f.edits[0].flags, MessageFlags.IsComponentsV2)
 assert.equal(f.client.commands.size, 4)
})
test('проверяет названия команд и роли до сохранения', () => {
 const { guild } = fixture()
 assert.throws(() => validateLists([{ ...list, removeName: list.addName }], guild), /уникальны/)
 assert.throws(() => validateLists([{ ...list, roleId: 'missing' }], guild), /роль списка/)
})

test('контекстная команда проверяет доступ и выдаёт только роль списка', async () => {
 const f = fixture()
 await f.service.save(asMock<Guild>(f.guild), [list], 0, { id: 'admin' })
 let added: string | null = null
 let replied!: Payload
 const interaction = { member: { permissions: { has: () => false }, roles: { cache: new Collection() } }, guild: f.guild, targetId: 'target', isUserContextMenuCommand: () => true, reply: async (value: Payload) => { replied = value }, deferReply: async () => {}, editReply: async () => {} }
 f.guild.members.fetch = async () => ({ roles: { add: async (role: string) => { added = role } } })
 await f.client.commands.get(list.addName)!.execute(interaction)
 assert.equal(added, null)
 assert.match(replied.content, /Недостаточно прав/)
 interaction.member.permissions.has = () => true
 await f.client.commands.get(list.addName)!.execute(interaction)
 assert.equal(added, 'role')
})

test('кнопки проверяют доступ и меняют роль выбранного участника', async () => {
 const previousGuildId = process.env.GUILD_ID
 process.env.GUILD_ID = 'guild'
 try {
  const f = fixture()
  f.guild.roles.cache.set('access', {})
  await f.service.save(asMock<Guild>(f.guild), [{ ...list, accessRoleId: 'access' }], 0, { id: 'admin' })
  let response!: Payload
  let changed: string[] | null = null
  const interaction = { guild: f.guild, channelId: 'channel', customId: `mcl_add_${id}`, member: { permissions: { has: () => false }, roles: { cache: new Collection() } }, isButton: () => true, reply: async (value: Payload) => { response = value }, deferUpdate: async () => {}, editReply: async (value: Payload) => { response = value }, values: ['target'] }
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.match(response.content, /Недостаточно прав/)
  interaction.member.roles.cache.set('access', {})
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.match(response.content, /Добавить в список «Игроки»/)
  assert.equal(response.flags, MessageFlags.Ephemeral)
  assert.equal(response.components[0].toJSON().components[0].type, 5)
  interaction.isButton = () => false
  f.guild.members.fetch = async ({ user: target } = { user: '' }) => ({ roles: { cache: new Collection([['role', {}]]), add: async (role: string) => { changed = [target, role] }, remove: async (role: string) => { changed = [target, role, 'remove'] } } })
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.deepEqual(changed, ['target', 'role'])
  interaction.customId = `mcl_remove_${id}`
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.deepEqual(changed, ['target', 'role', 'remove'])
  interaction.member.roles.cache.clear()
  changed = null
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.equal(changed, null)
  assert.match(response.content, /Недостаточно прав/)
 } finally {
  if (previousGuildId === undefined) delete process.env.GUILD_ID; else process.env.GUILD_ID = previousGuildId
 }
})

test('удаление предлагает только участников списка и показывает все страницы', async () => {
 const previousGuildId = process.env.GUILD_ID
 process.env.GUILD_ID = 'guild'
 try {
  const f = fixture()
  await f.service.save(asMock<Guild>(f.guild), [list], 0, { id: 'admin' })
  const members = new Collection(Array.from({ length: 26 }, (_, i) => [String(i + 1), { id: String(i + 1), displayName: `Игрок ${String(i + 1).padStart(2, '0')}`, roles: { cache: new Collection([['role', {}]]) } }]))
  members.set('99', { id: '99', displayName: 'Другой', roles: { cache: new Collection() } })
  f.guild.members.fetch = async () => members
  let response!: Payload
  const interaction = { guild: f.guild, channelId: 'channel', customId: `mcl_remove_${id}`, member: { permissions: { has: () => true }, roles: { cache: new Collection() } }, isButton: () => true, deferReply: async () => {}, deferUpdate: async () => {}, editReply: async (value: Payload) => { response = value } }
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  const menu = response.components[0].toJSON().components[0]
  assert.equal(menu.options.length, 25)
  assert.ok(!menu.options.some(option => option.value === '99'))
  assert.match(response.content, /страница 1\/2/)
  interaction.customId = `mcl_page_${id}_1`
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.deepEqual(response.components[0].toJSON().components[0].options.map(option => option.value), ['26'])
  members.clear()
  await f.service.handle(asMock<Parameters<typeof f.service.handle>[0]>(interaction))
  assert.match(response.content, /нет участников/)
  assert.deepEqual(response.components, [])
 } finally {
  if (previousGuildId === undefined) delete process.env.GUILD_ID; else process.env.GUILD_ID = previousGuildId
 }
})

test('bursts coalesce list refreshes, share member loads and skip unchanged writes', async () => {
 const f = fixture()
 await f.service.save(asMock<Guild>(f.guild), [list], 0, { id: 'admin' })
 await f.service.sync(asMock<Guild>(f.guild), true)
 const before = { reads: f.memberFetches, passes: f.syncPasses, edits: f.edits.length }
 await Promise.all(Array.from({ length: 100 }, () => f.service.sync(asMock<Guild>(f.guild), true)))
 assert.equal(f.memberFetches, before.reads)
 assert.ok(f.syncPasses - before.passes <= 2)
 assert.equal(f.edits.length, before.edits)
 f.state.mclLists[list.id].title = 'Новый заголовок'
 await Promise.all(Array.from({ length: 100 }, () => f.service.sync(asMock<Guild>(f.guild), true)))
 assert.equal(f.edits.length, before.edits + 1)
 assert.match(JSON.stringify(f.edits.at(-1)!.components[0].toJSON()), /Новый заголовок/)
})
