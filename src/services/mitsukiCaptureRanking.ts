const URL = 'https://mitsuki-hub.ru/api/ext-captures/family-stats?serverId=ru8&name=REVENTO&period=month&familyId=1698'

interface MitsukiPlayer {
	key: string
	staticId: string | null
	name: string
	captures: number
	avgDamage: number
	avgKills: number
	winrate: number
	rating: number | null
}

const numeric = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)

function parsePlayer(value: unknown): MitsukiPlayer {
	if (
		!value || typeof value !== 'object' ||
		!('key' in value && typeof value.key === 'string') ||
		!('static' in value && (value.static === null || numeric(value.static))) ||
		!('nickname' in value && typeof value.nickname === 'string') ||
		!('captures' in value && numeric(value.captures)) ||
		!('avgDamage' in value && numeric(value.avgDamage)) ||
		!('avgKills' in value && numeric(value.avgKills)) ||
		!('winrate' in value && numeric(value.winrate)) ||
		!('rating' in value && (value.rating === null || numeric(value.rating)))
	) throw new Error('Неожиданный формат игрока в рейтинге Mitsuki.')
	return {
		key: value.key, staticId: value.static === null ? null : String(value.static),
		name: value.nickname, captures: value.captures, avgDamage: value.avgDamage,
		avgKills: value.avgKills, winrate: value.winrate, rating: value.rating
	}
}

export async function fetchMitsukiCaptureRanking(fetchImpl = fetch) {
	const response = await fetchImpl(URL, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(15000),
		redirect: 'error'
	})
	if (!response.ok) throw new Error(`Mitsuki HTTP ${response.status}`)
	const data: unknown = await response.json()
	if (!data || typeof data !== 'object' || !('players' in data) || !Array.isArray(data.players))
		throw new Error('Неожиданный формат рейтинга Mitsuki.')
	// Mitsuki's K/D sort uses kills per capture (avgKills).
	const rows = data.players.map(parsePlayer).sort((a, b) =>
		a.rating === null && b.rating === null
			? b.avgKills - a.avgKills
			: (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
	let position = 0
	return rows.map((player, index) => {
		const previous = rows[index - 1]
		if (
			player.rating !== previous?.rating ||
			(player.rating === null && player.avgKills !== previous?.avgKills)
		)
			position = index + 1
		return { ...player, position }
	})
}
