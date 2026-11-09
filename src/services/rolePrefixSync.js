const { loadDiscordMembers } = require('./discordMembers')
const { adminPrefix } = require('../utils/adminPrefix')

async function syncRolePrefixes(guild, rolePrefixes) {
	const members = await loadDiscordMembers(guild)
	const result = { updated: 0, unchanged: 0, skipped: 0, failed: 0 }
	for (const member of members.values()) {
		const prefix = adminPrefix([...member.roles.cache.keys()], [], rolePrefixes)
		if (!prefix) continue
		const cleanName = member.displayName.replace(/^\[[^\]]*\]\s*/, '').trim()
		const nickname = `${prefix}${cleanName}`
		if (nickname === member.displayName) { result.unchanged++; continue }
		if (!member.manageable || nickname.length > 32) { result.skipped++; continue }
		try {
			await member.setNickname(nickname, 'Обновление префиксов из панели управления')
			result.updated++
		} catch { result.failed++ }
	}
	return result
}

module.exports = { syncRolePrefixes }
