const { adminPrefix } = require('../../utils/adminPrefix')

const rankRoles = Object.freeze({
	Dep: '1445808131832676558',
	High: '1445808131832676557',
	'Tier 1': '1499130225504813086',
	'Tier 2': '1499130275844587561',
	Recruit: '1499129607276986408',
	'Tier 3': '1499130321004921063',
	Main: '1499130866708775173',
	Farm: '1499142469479043212',
	Test: '1499338616973955174'
})
const managedRoles = new Set(Object.values(rankRoles))
const tierRoles = new Set(['Tier 1', 'Tier 2', 'Tier 3'].map(rank => rankRoles[rank]))
const ignoredRanks = new Set(['Leader', 'Own.dep'])

function parseNickname(nickname) {
	if (typeof nickname !== 'string') return null
	const match = /^(\[[^\]\r\n]+\]\s*)?([^|\r\n]+?)\s*\|\s*([1-9]\d*)(\s*\/[^\r\n]*)?$/.exec(nickname)
	if (!match) return null
	return { prefix: match[1] || '', static: match[3], suffix: match[4] || '' }
}

function buildPreview(characters, members, { decisions = {}, adminRoleIds = [] } = {}) {
	const byStatic = new Map(characters.map(character => [String(character.id), character]))
	const parsedMembers = members.filter(member => !member.bot).map(member => ({
		...member, parsed: parseNickname(member.nickname), decision: decisions[member.id] || {}
	}))
	for (const member of parsedMembers) {
		if (member.decision.static) member.parsed = {
			prefix: member.parsed?.prefix || /^(\[[^\]]+\]\s*)/.exec(member.nickname || '')?.[1] || '',
			suffix: member.parsed?.suffix || '', static: member.decision.static
		}
	}
	const counts = new Map()
	for (const member of parsedMembers) {
		if (member.parsed && !member.decision.excluded) counts.set(member.parsed.static, (counts.get(member.parsed.static) || 0) + 1)
	}
	return parsedMembers.map(member => {
		const row = { discordId: member.id, currentNickname: member.nickname, status: 'unchanged' }
		row.currentRoleIds = [...member.roleIds].sort()
		if (member.decision.excluded) return { ...row, status: 'excluded', reason: 'Исключён администратором из синхронизации.' }
		if (!member.parsed) return { ...row, status: 'skipped', reason: 'Ник не соответствует формату; привязка по static не определена.' }
		const { prefix, static: staticId, suffix } = member.parsed
		row.static = staticId
		if (counts.get(staticId) > 1) return { ...row, status: 'conflict', reason: 'Один static указан у нескольких участников Discord.' }
		const character = byStatic.get(staticId)
		if (!character) return { ...row, status: 'skipped', reason: 'Static отсутствует в составе; роли и ник не меняем.' }
		const rank = character.rankName.trim()
		row.gameRank = rank
		const currentRoles = member.roleIds.filter(id => managedRoles.has(id))
		let currentTiers = currentRoles.filter(id => tierRoles.has(id))
		if (currentTiers.includes(member.decision.tierRoleId)) currentTiers = [member.decision.tierRoleId]
		if (currentTiers.length > 1) return { ...row, status: 'conflict', reason: 'Несколько Tier-ролей: требуется ручной выбор.' }
		if (!ignoredRanks.has(rank) && !Object.hasOwn(rankRoles, rank)) {
			return { ...row, status: 'conflict', reason: 'Неизвестный игровой ранг.' }
		}
		const name = character.login.trim().split(/\s+/)[0]
		let nickname = `${prefix}${name} | ${staticId}${suffix}`
		if (nickname.length > 32) return { ...row, status: 'conflict', reason: 'Новый ник длиннее 32 символов; префикс, static и текст не обрезаем.' }
		row.nickname = nickname === member.nickname ? null : nickname
		row.addRoles = []
		row.removeRoles = []
		if (currentTiers.length || !ignoredRanks.has(rank)) {
			const targetRole = currentTiers[0] || rankRoles[rank]
			row.addRoles = currentRoles.includes(targetRole) ? [] : [targetRole]
			row.removeRoles = currentRoles.filter(id => id !== targetRole)
			row.preservedTier = currentTiers.length === 1
		} else {
			row.roleNote = 'Leader/Own.dep: синхронизация игрового ранга отключена.'
			if (currentRoles.length > 1) return { ...row, status: 'conflict', nickname: null, reason: 'Leader/Own.dep и несколько ранговых ролей: требуется ручной выбор.' }
		}
		if ([...row.addRoles, ...row.removeRoles].some(id => adminRoleIds.includes(id))) {
			const finalRoles = member.roleIds.filter(id => !row.removeRoles.includes(id)).concat(row.addRoles)
			nickname = `${adminPrefix(finalRoles, adminRoleIds)}${name} | ${staticId}${suffix}`
			if (nickname.length > 32) return { ...row, status: 'conflict', nickname: null, reason: 'Новый ник с префиксом длиннее 32 символов.' }
			row.nickname = nickname === member.nickname ? null : nickname
		}
		if (row.nickname || row.addRoles.length || row.removeRoles.length) row.status = 'change'
		return row
	})
}

module.exports = { rankRoles, tierRoles, parseNickname, buildPreview }
