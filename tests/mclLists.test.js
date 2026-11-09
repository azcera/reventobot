const test = require('node:test')
const assert = require('node:assert/strict')
const { Collection } = require('discord.js')
const { createMclLists, validateLists } = require('../src/services/mclLists')

const id = '00000000-0000-4000-8000-000000000001'
const list = { id, channelId: 'channel', roleId: 'role', accessRoleId: '', title: 'Игроки', addName: 'Добавить игрока', removeName: 'Убрать игрока' }
function fixture() {
 const sent = [], edits = []
 const message = { id: 'message', author: { id: 'bot' }, edit: async payload => edits.push(payload), delete: async () => {} }
 const channel = { type: 0, messages: { fetch: async () => message }, send: async payload => { sent.push(payload); return message } }
 const members = new Collection([['1', { id: '1', roles: { cache: new Collection([['role', {}]]) } }]])
 const commands = new Collection()
 const guild = { id: 'guild', roles: { cache: new Collection([['role', {}]]) }, channels: { cache: new Collection([['channel', channel]]), fetch: async () => channel }, members: { cache: members, fetch: async () => members }, commands: { fetch: async () => commands, create: async data => { commands.set(data.name, { ...data, delete: async () => commands.delete(data.name) }) } } }
 const state = { mclLists: {}, revision: 0, async save(section, values) { this.mclLists = Object.fromEntries(Object.entries(values).filter(([, value]) => value)); this.revision++ }, roleIds: () => [] }
 const rows = { commands: [], messages: [] }
 const pool = { async query(sql, args) {
  if (sql.startsWith('SELECT name')) return { rows: rows.commands.map(name => ({ name })) }
  if (sql.startsWith('SELECT channel_id')) return { rows: rows.messages }
  if (sql.startsWith('INSERT INTO mcl_commands')) rows.commands.push(args[1])
  if (sql.startsWith('INSERT INTO mcl_messages')) rows.messages = [{ channel_id: args[1], message_id: args[2] }]
  return { rows: [] }
 } }
 const client = { commands: new Collection(), user: { id: 'bot' } }
 return { guild, state, sent, edits, client, service: createMclLists({ client, pool, store: state }) }
}
test('публикация объединяет списки и повторно обновляет сообщение', async () => {
 const f = fixture()
 const other = { ...list, id: '00000000-0000-4000-8000-000000000002', title: 'Вторая группа', addName: 'Добавить второго', removeName: 'Убрать второго' }
 await f.service.save(f.guild, [list, other], 0, { id: 'admin' })
 assert.equal(f.sent.length, 1)
 assert.match(f.sent[0].content, /Игроки\*\*\n<@1>[\s\S]*Вторая группа\*\*\n<@1>/)
 assert.deepEqual(f.sent[0].allowedMentions, { parse: [] })
 await f.service.sync(f.guild, true)
 assert.equal(f.edits.length, 1)
 assert.equal(f.client.commands.size, 4)
})
test('проверяет названия команд и роли до сохранения', () => {
 const { guild } = fixture()
 assert.throws(() => validateLists([{ ...list, removeName: list.addName }], guild), /уникальны/)
 assert.throws(() => validateLists([{ ...list, roleId: 'missing' }], guild), /роль списка/)
})

test('контекстная команда проверяет доступ и выдаёт только роль списка', async () => {
 const f = fixture()
 await f.service.save(f.guild, [list], 0, { id: 'admin' })
 let added = null, replied = null
 const interaction = { member: { permissions: { has: () => false }, roles: { cache: new Collection() } }, guild: f.guild, targetId: 'target', reply: async value => { replied = value }, deferReply: async () => {}, editReply: async () => {} }
 f.guild.members.fetch = async () => ({ roles: { add: async role => { added = role } } })
 await f.client.commands.get(list.addName).execute(interaction)
 assert.equal(added, null)
 assert.match(replied.content, /Недостаточно прав/)
 interaction.member.permissions.has = () => true
 await f.client.commands.get(list.addName).execute(interaction)
 assert.equal(added, 'role')
})
