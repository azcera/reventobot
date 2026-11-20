import { battleSummary, FAMILY_ID } from './familyWarData'
import type { War } from './familyWarTypes'

export const CAPTURE_RANKING_SCHEMA = `
CREATE TABLE IF NOT EXISTS capture_statistics (
	guild_id TEXT NOT NULL, war_key TEXT NOT NULL, result JSONB NOT NULL,
	PRIMARY KEY (guild_id, war_key)
);
ALTER TABLE capture_statistics ADD COLUMN IF NOT EXISTS included BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS capture_stat_messages (
	guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, card_key TEXT NOT NULL,
	message_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
	PRIMARY KEY (guild_id, channel_id, card_key)
);
CREATE TABLE IF NOT EXISTS capture_sort_preferences (
	guild_id TEXT PRIMARY KEY, mode TEXT NOT NULL
)`

interface PlayerStats {
	staticId: string
	name: string
	kills: number | null
	deaths?: number | null
	damage: number | null
	mvp: number
}

export interface CaptureStats {
	key: string
	at: number
	enemy: string
	attack: boolean
	result: string
	players: PlayerStats[]
}

export function captureStats(war: War): CaptureStats | null {
	if (war.status !== 'finished' || war.neutral || war.testSource || !war.rosterFresh)
		return null
	const source = war.raw.players?.[FAMILY_ID]
	if (!source?.length) return null
	const battle = battleSummary(war)
	if (!battle.killsMvp && !battle.damageMvp) return null
	const stat = (value?: number) =>
		value !== undefined && Number.isFinite(value) && value >= 0 ? value : null
	const players = source.map(player => {
		const kills = stat(player.kills)
		const damage = stat(player.damage)
		return {
			staticId: String(player.id),
			name: player.name,
			kills,
			deaths: Number.isSafeInteger(player.deaths) ? stat(player.deaths) : null,
			damage,
			mvp: Number(kills === battle.killsMvp?.kills) +
				Number(damage === battle.damageMvp?.damage)
		}
	})
	return {
		key: war.key,
		at: war.startAt,
		enemy: war.enemy,
		attack: war.attack,
		result: battle.result,
		players
	}
}

export interface CaptureHistoryRow extends PlayerStats {
	key: string
	at: number
	enemy: string
	attack: boolean
	result: string
}

export function captureHistories(captures: CaptureStats[]) {
	const histories = new Map<string, CaptureHistoryRow[]>()
	for (const capture of [...captures].sort((a, b) => b.at - a.at || b.key.localeCompare(a.key))) {
		for (const player of capture.players) {
			const history = histories.get(player.staticId) ?? []
			history.push({
				...player, key: capture.key, at: capture.at, enemy: capture.enemy,
				attack: capture.attack, result: capture.result
			})
			histories.set(player.staticId, history)
		}
	}
	return histories
}

const HALF_LIFE = 30 * 86400000
const PRIOR_CAPTURES = 5

function performance(games: CaptureHistoryRow[], latest: number) {
	let damage = 0, damageWeight = 0, kills = 0, killsWeight = 0
	let rawKills = 0, reportedKills = 0, rawDamage = 0, reportedDamage = 0
	let wins = 0, decided = 0, mvps = 0, weight = 0, mvp = 0
	for (const game of games) {
		const recent = 2 ** ((game.at - latest) / HALF_LIFE)
		weight += recent
		mvp += game.mvp
		mvps += recent * game.mvp
		if (game.damage !== null) {
			rawDamage += game.damage
			reportedDamage++
			damage += recent * game.damage
			damageWeight += recent
		}
		if (game.kills !== null) {
			rawKills += game.kills
			reportedKills++
			kills += recent * game.kills
			killsWeight += recent
		}
		if (game.result === 'Победа' || game.result === 'Поражение') {
			decided += recent
			if (game.result === 'Победа') wins += recent
		}
	}
	return {
		damage, damageWeight, kills, killsWeight, wins, decided, mvps, weight, mvp,
		averageDamage: rawDamage / (reportedDamage || 1),
		averageKills: reportedKills ? rawKills / reportedKills : null
	}
}

export function rankCapturePlayers(
	histories: ReturnType<typeof captureHistories>,
	members: ReadonlySet<string>,
	killPercent: number,
	excluded: ReadonlySet<string> = new Set()
) {
	const players = [...histories].flatMap(([staticId, history]) => {
		if (!members.has(staticId)) return []
		const games = history.filter(game => !excluded.has(game.key))
		return games.length ? [{ staticId, name: history[0].name, games }] : []
	})
	const latest = players.reduce((max, player) => Math.max(max, player.games[0].at), 0)
	const samples = players.map(player => ({ ...player, performance: performance(player.games, latest) }))
	const total = (key: keyof Omit<ReturnType<typeof performance>, 'averageKills'>) =>
		samples.reduce((sum, player) => sum + player.performance[key], 0)
	const mean = (value: number, exposure: number) => exposure ? value / exposure : 0
	const baseDamage = mean(total('damage'), total('damageWeight'))
	const baseKills = mean(total('kills'), total('killsWeight'))
	const baseMvp = mean(total('mvps'), total('weight'))
	const baseWins = total('decided') ? total('wins') / total('decided') : 0.5
	const smooth = (value: number, exposure: number, baseline: number) =>
		(value + PRIOR_CAPTURES * baseline) / (exposure + PRIOR_CAPTURES)
	const compareToFamily = (value: number, baseline: number) =>
		baseline > 0 ? value / (value + baseline) : 0.5
	// Small samples trend toward a conservative estimate on the 0–1 scale.
	const combatEstimate = (value: number, exposure: number, baseline: number) =>
		smooth(compareToFamily(value, baseline) * exposure, exposure, 0.15)

	return samples.map(({ staticId, name, games, performance: stats }) => {
		const damage = combatEstimate(mean(stats.damage, stats.damageWeight), stats.damageWeight, baseDamage)
		const kills = combatEstimate(mean(stats.kills, stats.killsWeight), stats.killsWeight, baseKills)
		const combatWeight = stats.killsWeight ? killPercent / 100 : 0
		const mvp = compareToFamily(smooth(stats.mvps, stats.weight, baseMvp), baseMvp)
		const result = smooth(stats.wins, stats.decided, baseWins)
		const experience = games.length / (games.length + 10)
		const score = 0.65 * (kills * combatWeight + damage * (1 - combatWeight)) +
			0.15 * mvp + 0.05 * result + 0.15 * experience
		return {
			score, staticId, name, captures: games.length,
			damage: stats.averageDamage, averageKills: stats.averageKills, mvp: stats.mvp
		}
	}).sort((a, b) => b.score - a.score || b.captures - a.captures ||
		b.mvp - a.mvp || Number(a.staticId) - Number(b.staticId))
		.map(({ score, ...player }, index) => ({ ...player, position: index + 1 }))
}
