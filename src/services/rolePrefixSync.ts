import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { loadDiscordMembers } from './discordMembers'
import { adminPrefix } from '../utils/adminPrefix'
import { parseDisplayName } from '../utils/parseDisplayName'

async function syncRolePrefixes(guild: D.Guild, rolePrefixes: T.RolePrefix[]) {
	const members = await loadDiscordMembers(guild)
	const result = { updated: 0, unchanged: 0, skipped: 0, failed: 0 }
	for (const member of members!.values()) {
		const prefix = adminPrefix([...member.roles.cache.keys()], [], rolePrefixes)
		if (!prefix) continue
		const parsed = parseDisplayName(member.displayName, rolePrefixes)
		// Recover the name from an older tag when its dashboard value has changed.
		const cleanName = parsed ? `${parsed.memberName} | ${parsed.memberStatic}${member.displayName.split('|')[1].replace(/^\s*\d+/, '')}`
			: member.displayName.match(/([A-Za-z]+\s*\|\s*\d+(?:\s*\/.*)?)$/)?.[1]
		if (!cleanName) { result.skipped++; continue }
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

export { syncRolePrefixes }
