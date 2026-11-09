module.exports = client => {
 const update = member => {
  if (!client.mclLists || member.guild.id !== process.env.GUILD_ID) return
  client.mclLists.sync(member.guild, true).catch(error => console.error('[MCL] Ошибка синхронизации:', error))
 }
 client.on('guildMemberAdd', update)
 client.on('guildMemberRemove', update)
 client.on('guildMemberUpdate', (before, after) => {
  if (before.partial || after.partial || before.roles.cache.size !== after.roles.cache.size || before.roles.cache.some(role => !after.roles.cache.has(role.id))) update(after)
 })
}
