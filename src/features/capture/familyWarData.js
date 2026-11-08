const FAMILY_ID = 1698
const SERVER = 'RU8'
const PAGE_SIZE = 20

function rulesFromEnv(env = process.env) {
	const list = (key, fallback) => (env[key] ?? fallback).split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
	return {
		closed: new Set(list('FAMILY_WARS_CLOSED_STATUSES', 'finished')),
		neutralIds: new Set(list('FAMILY_WARS_NEUTRAL_IDS', '0,-1')),
		neutralNames: new Set(list('FAMILY_WARS_NEUTRAL_NAMES', 'нейтрал,нейтральная территория,нейтральная клетка,нейтральная зона,neutral,neutral territory,neutral zone'))
	}
}

function moscowDay(time) {
	return new Date(new Date(time).getTime() + 3 * 3600000).toISOString().slice(0, 10)
}

function nextPollAt(time) {
	const current = new Date(time).getTime()
	let next = Math.floor(current / 60000) * 60000 + 5000
	if (next <= current) next += 60000
	const moscow = new Date(next + 3 * 3600000)
	const minute = moscow.getUTCHours() * 60 + moscow.getUTCMinutes()
	if (minute < 15 * 60) moscow.setUTCHours(15, 0, 5, 0)
	else if (minute > 21 * 60 + 30) {
		moscow.setUTCDate(moscow.getUTCDate() + 1)
		moscow.setUTCHours(15, 0, 5, 0)
	}
	return moscow.getTime() - 3 * 3600000
}

function normalizeWar(raw, rules, previous, now = Date.now()) {
	if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 ||
		!Number.isSafeInteger(raw.defendersId) || !Number.isSafeInteger(raw.attackersId)) throw new Error('Некорректные ID капта или семей.')
	if (raw.defendersId !== FAMILY_ID && raw.attackersId !== FAMILY_ID) return null
	const startAt = Date.parse(raw.startAt)
	if (!Number.isFinite(startAt)) throw new Error('Некорректное время начала капта.')
	const name = value => typeof value === 'string' ? value.trim().slice(0, 150) : ''
	const neutral = [raw.defendersId, raw.attackersId].some(id => rules.neutralIds.has(String(id))) ||
		[raw.defendersName, raw.attackersName].some(value => rules.neutralNames.has(name(value).toLowerCase()))
	const status = String(raw.status ?? '').trim().toLowerCase()
	let roster = null
	const source = raw.players?.[String(FAMILY_ID)]
	if (Array.isArray(source) && source.every(player => player && Number.isSafeInteger(player.id) && player.id > 0 &&
		(player.familyId === undefined || player.familyId === FAMILY_ID) && typeof player.name === 'string') &&
		new Set(source.map(player => player.id)).size === source.length) {
		roster = source.map(player => ({ static: String(player.id), name: name(player.name) }))
	}
	return {
		key: `${SERVER}:${raw.id}`, apiId: raw.id, captureId: raw.captureId ?? null,
		attack: raw.attackersId === FAMILY_ID,
		enemy: name(raw.attackersId === FAMILY_ID ? raw.defendersName : raw.attackersName) || 'Неизвестная семья',
		zone: raw.gangZoneId, map: name(raw.selectedMapName) || 'Карта не указана',
		startAt, status, neutral, closed: rules.closed.has(status), updatedAt: now,
		roster: roster ?? previous?.roster ?? [], rosterFresh: roster !== null,
		rosterUpdatedAt: roster !== null ? now : previous?.rosterUpdatedAt ?? null,
		raw
	}
}

function canAnnounce(war, now) {
	return !war.neutral && !war.closed && war.startAt >= now && moscowDay(war.startAt) === moscowDay(now)
}

function registrationClosed(war, now) {
	return war.closed || war.neutral || moscowDay(war.startAt) < moscowDay(now) ||
		(!war.testSource && now >= war.startAt - 3 * 60000)
}

function battleSummary(war) {
	const raw = war.raw
	const enemyId = war.attack ? raw.defendersId : raw.attackersId
	const count = value => Number.isInteger(value) && value >= 0
	let ours = raw.score?.[FAMILY_ID], theirs = raw.score?.[enemyId], estimated = false
	if (!count(ours) || !count(theirs)) {
		const stats = id => {
			const players = raw.players?.[id]
			if (!Array.isArray(players) || !players.length || !players.every(player =>
				Number.isFinite(player.damage) && player.damage >= 0 && count(player.kills))) return null
			return { initial: players.filter(player => player.damage >= 1).length,
				kills: players.reduce((total, player) => total + player.kills, 0) }
		}
		const own = stats(FAMILY_ID), enemy = stats(enemyId)
		if (own && enemy) {
			ours = Math.max(0, own.initial - enemy.kills)
			theirs = Math.max(0, enemy.initial - own.kills)
			estimated = true
		} else ours = theirs = null
	}
	const winner = raw.winnerFamilyId ?? raw.winnerId
	const result = winner === FAMILY_ID ? 'Победа' : winner === enemyId ? 'Поражение' :
		war.status === 'finished' && ours !== null && (ours === 0 || theirs === 0) ?
			(ours === theirs ? 'Ничья' : ours > theirs ? 'Победа' : 'Поражение') : 'Неизвестен'
	return { ours, theirs, estimated, result }
}

function bindingIndex(members, decisions = {}) {
	const index = new Map()
	for (const member of members) {
		if (member.user.bot || decisions[member.id]?.excluded) continue
		const staticId = decisions[member.id]?.static || /\|\s*([1-9]\d*)(?:\s*\/.*)?\s*$/.exec(member.nickname || '')?.[1]
		if (!staticId) continue
		if (!index.has(staticId)) index.set(staticId, [])
		index.get(staticId).push(member.id)
	}
	return index
}

function queueRows(war, registration, members, decisions, priorityRoles, now) {
	const bindings = bindingIndex(members.values(), decisions)
	const byUser = new Map()
	for (const [staticId, ids] of bindings) if (ids.length === 1) byUser.set(ids[0], staticId)
	const joins = registration.joins || {}
	const seen = registration.seen || {}
	const declined = registration.declined || {}
	const rows = war.roster.map(player => {
		const ids = bindings.get(player.static) || []
		const userId = ids.length === 1 ? ids[0] : null
		return { ...player, userId, confirmed: true, conflict: ids.length > 1,
			joinedAt: (userId && joins[userId]?.joinedAt) ?? seen[player.static] ?? now,
			declined: Boolean(userId && declined[userId]) }
	})
	const inGame = new Set(war.roster.map(player => player.static))
	for (const [userId, join] of Object.entries(joins)) {
		const staticId = byUser.get(userId)
		if (staticId && inGame.has(staticId)) continue
		rows.push({ userId, static: staticId || null, name: '', confirmed: false,
			conflict: !staticId, joinedAt: join.joinedAt })
	}
	const priority = userId => {
		const member = members.get(userId)
		const index = priorityRoles.findIndex(id => member?.roles.cache.has(id))
		return index < 0 ? priorityRoles.length : index
	}
	return rows.sort((a, b) => (registration.sortMode === 'time' ? 0 : priority(a.userId) - priority(b.userId)) ||
		a.joinedAt - b.joinedAt || String(a.static || a.userId).localeCompare(String(b.static || b.userId)))
}

module.exports = { FAMILY_ID, SERVER, PAGE_SIZE, rulesFromEnv, moscowDay, nextPollAt, normalizeWar, canAnnounce, registrationClosed, battleSummary, bindingIndex, queueRows }
