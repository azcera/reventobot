const { ApplicationCommandType, ContextMenuCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js')
const { problem } = require('../dashboard/auth')

function validateLists(lists, guild) {
 if (!Array.isArray(lists) || lists.length > 6) throw problem(400, 'Можно создать не более 6 списков: Discord ограничивает число команд.')
 const names = new Set(['Создать архив', 'Открыть архив'])
 const ids = new Set()
 for (const list of lists) {
  if (!list || typeof list.id !== 'string' || !/^[a-f0-9-]{36}$/.test(list.id) || ids.has(list.id)) throw problem(400, 'Некорректный список.')
  ids.add(list.id)
  const channel = guild.channels.cache.get(list.channelId)
  if (!channel || channel.type !== 0) throw problem(400, 'Выберите текстовый канал сервера.')
  if (!guild.roles.cache.has(list.roleId) || list.roleId === guild.id) throw problem(400, 'Выберите роль списка.')
  if (list.accessRoleId && (!guild.roles.cache.has(list.accessRoleId) || list.accessRoleId === guild.id)) throw problem(400, 'Выберите роль доступа.')
  if (typeof list.title !== 'string' || !list.title.trim() || list.title.length > 100 || /[\r\n]/.test(list.title)) throw problem(400, 'Заголовок должен содержать от 1 до 100 символов в одной строке.')
  for (const name of [list.addName, list.removeName]) {
   if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 32 || /[\r\n]/.test(name) || names.has(name)) throw problem(400, 'Названия команд должны быть уникальны и содержать от 1 до 32 символов.')
   names.add(name)
  }
 }
}

function canManage(interaction, list, store) {
 return interaction.member.permissions.has(PermissionFlagsBits.Administrator) || store.roleIds('ADMIN_ROLES').some(id => interaction.member.roles.cache.has(id)) || Boolean(list.accessRoleId && interaction.member.roles.cache.has(list.accessRoleId))
}

function createMclLists({ client, pool, store }) {
 let queue = Promise.resolve()
 const serial = fn => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next }
 async function sync(guild, messagesOnly = false) {
  const lists = Object.values(store.mclLists)
  const desired = new Map(lists.flatMap(list => [[list.addName, { list, add: true }], [list.removeName, { list, add: false }]]))
  if (!messagesOnly) {
  const registered = await pool.query('SELECT name FROM mcl_commands WHERE guild_id = $1', [guild.id])
  const remote = await guild.commands.fetch()
  for (const row of registered.rows) if (!desired.has(row.name)) {
   const command = remote.find(item => item.type === ApplicationCommandType.User && item.name === row.name)
   if (command) await command.delete()
   client.commands.delete(row.name)
   await pool.query('DELETE FROM mcl_commands WHERE guild_id = $1 AND name = $2', [guild.id, row.name])
  }
  for (const [name, entry] of desired) {
   const existing = remote.find(item => item.type === ApplicationCommandType.User && item.name === name)
   if (existing && !registered.rows.some(row => row.name === name)) throw new Error('Команда «' + name + '» уже существует в Discord.')
   const data = new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User)
   if (!existing) await guild.commands.create(data.toJSON())
   await pool.query('INSERT INTO mcl_commands (guild_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guild.id, name])
   client.commands.set(name, { data, async execute(interaction) {
    const current = Object.values(store.mclLists).find(item => item.id === entry.list.id)
    const add = current?.addName === name
    if (!current || (!add && current.removeName !== name)) return interaction.reply({ content: 'Команда больше не настроена.', flags: MessageFlags.Ephemeral })
    if (!canManage(interaction, current, store)) return interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral })
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const member = await interaction.guild.members.fetch(interaction.targetId)
    if (add) await member.roles.add(current.roleId); else await member.roles.remove(current.roleId)
    await interaction.editReply(add ? 'Роль выдана.' : 'Роль снята.')
   } })
  }
  }
  const tracked = await pool.query('SELECT channel_id, message_id FROM mcl_messages WHERE guild_id = $1', [guild.id])
  const channels = new Set([...lists.map(list => list.channelId), ...tracked.rows.map(row => row.channel_id)])
  if (lists.length) await guild.members.fetch()
  for (const channelId of channels) {
   const channelLists = lists.filter(list => list.channelId === channelId)
   const row = tracked.rows.find(item => item.channel_id === channelId)
   const channel = await guild.channels.fetch(channelId).catch(error => { if (error.code === 10003) return null; throw error })
   if (!channel) { if (channelLists.length) throw new Error('Канал списка недоступен.'); await pool.query('DELETE FROM mcl_messages WHERE guild_id = $1 AND channel_id = $2', [guild.id, channelId]); continue }
   let message = row && await channel.messages.fetch(row.message_id).catch(error => { if (error.code === 10008) return null; throw error })
   if (message && message.author.id !== client.user.id) throw new Error('Сообщение списка принадлежит другому автору.')
   if (!channelLists.length) {
    if (message) await message.delete()
    await pool.query('DELETE FROM mcl_messages WHERE guild_id = $1 AND channel_id = $2', [guild.id, channelId]); continue
   }
   const sections = channelLists.map(list => {
    const members = [...guild.members.cache.values()].filter(member => member.roles.cache.has(list.roleId)).map(member => `- <@${member.id}>`)
    return `### ${list.title.replace(/([\\*_~\x60|])/g, '\\$1')}\n${members.join('\n') || 'Нет участников'}`
   })
   if (sections.join('\n\n').length > 2000) throw new Error('Списки в канале превышают лимит Discord в 2000 символов.')
   const container = new ContainerBuilder()
   channelLists.forEach((list, index) => {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(sections[index]))
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
     new ButtonBuilder().setCustomId(`mcl_add_${list.id}`).setLabel('+').setStyle(ButtonStyle.Secondary),
     new ButtonBuilder().setCustomId(`mcl_remove_${list.id}`).setLabel('−').setStyle(ButtonStyle.Secondary)))
   })
   const payload = { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
   if (message) await message.edit({ ...payload, ...(message.content ? { content: null } : {}) }); else {
    message = await channel.send(payload)
    await pool.query('INSERT INTO mcl_messages (guild_id, channel_id, message_id) VALUES ($1, $2, $3) ON CONFLICT (guild_id, channel_id) DO UPDATE SET message_id = EXCLUDED.message_id', [guild.id, channelId, message.id])
   }
  }
 }
 return { sync: (guild, messagesOnly = false) => serial(() => sync(guild, messagesOnly)), async handle(interaction) {
  const match = /^mcl_(add|remove)_([a-f0-9-]{36})$/.exec(interaction.customId)
  const list = match && store.mclLists[match[2]]
  if (!list || interaction.guild?.id !== process.env.GUILD_ID || interaction.channelId !== list.channelId) return interaction.reply({ content: 'Список больше недоступен.', flags: MessageFlags.Ephemeral })
  if (!canManage(interaction, list, store)) return interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral })
  const add = match[1] === 'add'
  if (interaction.isButton()) {
   const menu = new UserSelectMenuBuilder().setCustomId(interaction.customId).setPlaceholder(add ? 'Выберите участника для добавления' : 'Выберите участника для удаления').setMinValues(1).setMaxValues(1)
   return interaction.reply({ content: `${add ? 'Добавить в список' : 'Убрать из списка'} «${list.title}»:`, components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
  }
  await interaction.deferUpdate()
  try {
   const member = await interaction.guild.members.fetch(interaction.values[0])
   if (add) await member.roles.add(list.roleId); else await member.roles.remove(list.roleId)
   await interaction.editReply({ content: add ? 'Роль выдана.' : 'Роль снята.', components: [] })
  } catch (error) {
   console.error('[Lists] Ошибка изменения роли:', error)
   await interaction.editReply({ content: 'Не удалось изменить роль. Проверьте права и иерархию ролей бота.', components: [] })
  }
 }, async save(guild, lists, revision, actor) {
  validateLists(lists, guild)
  return serial(async () => {
   const old = store.mclLists
   const remote = await guild.commands.fetch()
   const tracked = await pool.query('SELECT name FROM mcl_commands WHERE guild_id = $1', [guild.id])
   const owned = new Set(tracked.rows.map(row => row.name))
   const desiredNames = lists.flatMap(list => [list.addName, list.removeName])
   if (remote.filter(command => command.type === ApplicationCommandType.User && !owned.has(command.name)).size + desiredNames.length > 15) throw problem(400, 'Превышен лимит команд пользователей Discord.')
   for (const name of desiredNames) {
    if (remote.some(command => command.type === ApplicationCommandType.User && command.name === name && !owned.has(name)) || (client.commands.has(name) && !owned.has(name))) throw problem(400, 'Команда «' + name + '» уже существует.')
   }
   const values = Object.fromEntries([...Object.keys(old).map(id => [id, null]), ...lists.map(list => [list.id, list])])
   if (Object.keys(values).length) await store.save('mclLists', values, revision, actor)
   try { await sync(guild) } catch (error) { throw problem(502, 'Настройки сохранены, но синхронизация не завершена: ' + error.message) }
   return { lists: Object.values(store.mclLists), revision: store.revision }
  })
 } }
}
module.exports = { createMclLists, validateLists }
