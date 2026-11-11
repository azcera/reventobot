import { loadDiscordMembers } from './discordMembers'
import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { ApplicationCommandType, ContextMenuCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js'
import { problem } from '../dashboard/auth'

function validateLists(lists: T.MclList[], guild: D.Guild) {
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

function canManage(interaction: T.GuildInteraction, list: T.MclList, store: T.Store) {
 return interaction.member.permissions.has(PermissionFlagsBits.Administrator) || store.roleIds('ADMIN_ROLES').some(id => interaction.member.roles.cache.has(id)) || Boolean(list.accessRoleId && interaction.member.roles.cache.has(list.accessRoleId))
}

function createMclLists({ client, pool, store }: T.ServiceOptions) {
 let queue: Promise<unknown> = Promise.resolve()
 const refreshes = new Map<string, { dirty: boolean; pending: Promise<void> }>()
 const published = new Map<string, string>()
 const serial = <R>(fn: () => Promise<R>) => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next }
 async function sync(guild: D.Guild, messagesOnly = false) {
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
   client.commands.set(name, { data, async execute(interaction: T.GuildInteraction) {
    if (!interaction.isUserContextMenuCommand()) return
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
  if (lists.length) await loadDiscordMembers(guild)
  for (const channelId of channels) {
   const channelLists = lists.filter(list => list.channelId === channelId)
   const row = tracked.rows.find(item => item.channel_id === channelId)
   const channel = await guild.channels.fetch(channelId).catch(error => { if (error.code === 10003) return null; throw error })
   if (!channel || !channel.isTextBased()) { if (channelLists.length) throw new Error('Канал списка недоступен.'); await pool.query('DELETE FROM mcl_messages WHERE guild_id = $1 AND channel_id = $2', [guild.id, channelId]); continue }
   let message = row && await channel.messages.fetch(row.message_id).catch(error => { if (error.code === 10008) return null; throw error })
   if (message && message.author.id !== client.user!.id) throw new Error('Сообщение списка принадлежит другому автору.')
   if (!message && row) published.delete(row.message_id)
   if (!channelLists.length) {
    if (message) { await message.delete(); published.delete(message.id) }
    await pool.query('DELETE FROM mcl_messages WHERE guild_id = $1 AND channel_id = $2', [guild.id, channelId]); continue
   }
   const sections = channelLists.map(list => {
    const members = [...guild.members.cache.values()].filter((member: D.GuildMember) => member.roles.cache.has(list.roleId)).map((member: D.GuildMember) => `- <@${member.id}>`)
    return `### ${list.title.replace(/([\\*_~\x60|])/g, '\\$1')}\n${members.join('\n') || 'Нет участников'}`
   })
   if (sections.join('\n\n').length > 2000) throw new Error('Списки в канале превышают лимит Discord в 2000 символов.')
   const container = new ContainerBuilder()
   channelLists.forEach((list, index) => {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(sections[index]))
    container.addActionRowComponents(new ActionRowBuilder<D.MessageActionRowComponentBuilder>().addComponents(
     new ButtonBuilder().setCustomId(`mcl_add_${list.id}`).setLabel('+').setStyle(ButtonStyle.Secondary),
     new ButtonBuilder().setCustomId(`mcl_remove_${list.id}`).setLabel('−').setStyle(ButtonStyle.Secondary)))
   })
   const payload = { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } }
   const fingerprint = JSON.stringify(payload)
   if (message && !message.content && published.get(message.id) === fingerprint) continue
   if (message) await message.edit({ ...payload, ...(message.content ? { content: null } : {}) }); else {
    message = await channel.send(payload)
    await pool.query('INSERT INTO mcl_messages (guild_id, channel_id, message_id) VALUES ($1, $2, $3) ON CONFLICT (guild_id, channel_id) DO UPDATE SET message_id = EXCLUDED.message_id', [guild.id, channelId, message.id])
   }
   published.set(message.id, fingerprint)
  }
 }
 function refresh(guild: D.Guild, messagesOnly = false) {
  if (!messagesOnly) return serial(() => sync(guild, false))
  const previous = refreshes.get(guild.id)
  if (previous) { previous.dirty = true; return previous.pending }
  const state = { dirty: false, pending: Promise.resolve() }
  refreshes.set(guild.id, state)
  state.pending = serial(async () => {
   do { state.dirty = false; await sync(guild, true) } while (state.dirty)
  }).finally(() => { if (refreshes.get(guild.id) === state) refreshes.delete(guild.id) })
  return state.pending
 }
 return { sync: refresh, async handle(interaction: D.ButtonInteraction<'cached'> | D.StringSelectMenuInteraction<'cached'> | D.UserSelectMenuInteraction<'cached'>) {
  const match = /^mcl_(add|remove|page)_([a-f0-9-]{36})(?:_(\d+))?$/.exec(interaction.customId)
  const list = match && store.mclLists[match[2]]
  if (!list || interaction.guild?.id !== process.env.GUILD_ID || interaction.channelId !== list.channelId) return interaction.reply({ content: 'Список больше недоступен.', flags: MessageFlags.Ephemeral })
  if (!canManage(interaction, list, store)) return interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral })
  const add = match[1] === 'add'
  if (interaction.isButton() && add) {
   const menu = new UserSelectMenuBuilder().setCustomId(interaction.customId).setPlaceholder('Выберите участника для добавления').setMinValues(1).setMaxValues(1)
   return interaction.reply({ content: `Добавить в список «${list.title}»:`, components: [new ActionRowBuilder<D.UserSelectMenuBuilder>().addComponents(menu)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
  }
  if (interaction.isButton()) {
   if (match[1] === 'page') await interaction.deferUpdate(); else await interaction.deferReply({ flags: MessageFlags.Ephemeral })
   try {
    const members = [...(await interaction.guild.members.fetch()).values()].filter((member: D.GuildMember) => member.roles.cache.has(list.roleId))
     .sort((a, b) => (a.displayName || a.id).localeCompare(b.displayName || b.id) || a.id.localeCompare(b.id))
    if (!members.length) return interaction.editReply({ content: `В списке «${list.title}» нет участников.`, components: [], allowedMentions: { parse: [] } })
    const pages = Math.ceil(members.length / 25)
    const page = Math.min(Number(match[3] || 0), pages - 1)
    const menu = new StringSelectMenuBuilder().setCustomId(`mcl_remove_${list.id}`).setPlaceholder('Выберите участника для удаления').addOptions(members.slice(page * 25, page * 25 + 25).map((member: D.GuildMember) => ({ label: (member.displayName || member.id).slice(0, 100), value: member.id })))
    const rows: D.ActionRowBuilder<D.MessageActionRowComponentBuilder>[] = [new ActionRowBuilder<D.StringSelectMenuBuilder>().addComponents(menu)]
    if (pages > 1) rows.push(new ActionRowBuilder<D.MessageActionRowComponentBuilder>().addComponents(
     new ButtonBuilder().setCustomId(`mcl_page_${list.id}_${Math.max(page - 1, 0)}`).setLabel('←').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
     new ButtonBuilder().setCustomId(`mcl_page_${list.id}_${Math.min(page + 1, pages - 1)}`).setLabel('→').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)))
    return interaction.editReply({ content: `Убрать из списка «${list.title}»: ${pages > 1 ? `страница ${page + 1}/${pages}` : ''}`, components: rows, allowedMentions: { parse: [] } })
   } catch (caughtError) {
 const error = getError(caughtError)

    console.error('[Lists] Ошибка загрузки участников:', error)
    return interaction.editReply({ content: 'Не удалось загрузить участников списка.', components: [] })
   }
  }
  await interaction.deferUpdate()
  try {
   const member = await interaction.guild.members.fetch({ user: interaction.values[0], force: true })
   if (!add && !member.roles.cache.has(list.roleId)) return interaction.editReply({ content: 'Участник уже отсутствует в списке.', components: [] })
   if (add) await member.roles.add(list.roleId); else await member.roles.remove(list.roleId)
   await interaction.editReply({ content: add ? 'Роль выдана.' : 'Роль снята.', components: [] })
  } catch (caughtError) {
 const error = getError(caughtError)

   console.error('[Lists] Ошибка изменения роли:', error)
   await interaction.editReply({ content: 'Не удалось изменить роль. Проверьте права и иерархию ролей бота.', components: [] })
  }
 }, async save(guild: D.Guild, lists: T.MclList[], revision: number, actor: T.Actor | undefined) {
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
   try { await sync(guild) } catch (caughtError) {
 const error = getError(caughtError)
 throw problem(502, 'Настройки сохранены, но синхронизация не завершена: ' + error.message) }
   return { lists: Object.values(store.mclLists), revision: store.revision }
  })
 } }
}
export { createMclLists, validateLists }
