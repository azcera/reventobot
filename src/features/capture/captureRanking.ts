import { battleSummary, FAMILY_ID } from './familyWarData'
import type { War } from './familyWarTypes'

export const CAPTURE_RANKING_SCHEMA = `
CREATE TABLE IF NOT EXISTS capture_statistics (
	guild_id TEXT NOT NULL, war_key TEXT NOT NULL, result JSONB NOT NULL,
	PRIMARY KEY (guild_id, war_key)
);
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
				...player, at: capture.at, enemy: capture.enemy,
				attack: capture.attack, result: capture.result
			})
			histories.set(player.staticId, history)
		}
	}
	return histories
}

export function rankCapturePlayers(
	histories: ReturnType<typeof captureHistories>,
	members: ReadonlySet<string>,
	killPercent: number
) {
	const players = [...histories].flatMap(([staticId, games]) => {
		if (!members.has(staticId)) return []
		const average = (key: 'kills' | 'damage') => {
			const values = games.flatMap(game => game[key] ?? [])
			return values.reduce((total, value) => total + value, 0) / (values.length || 1)
		}
		return [{
			staticId, name: games[0].name, captures: games.length,
			kills: average('kills'), damage: average('damage'),
			mvp: games.reduce((total, game) => total + game.mvp, 0)
		}]
	})
	const max = (key: 'kills' | 'damage' | 'mvp') =>
		players.reduce((top, player) => Math.max(top, player[key]), 0) || 1
	const maxKills = max('kills')
	const maxDamage = max('damage')
	const maxMvp = max('mvp')
	const score = (player: typeof players[number]) =>
		0.85 * (player.kills / maxKills * killPercent +
			player.damage / maxDamage * (100 - killPercent)) / 100 +
		0.15 * player.mvp / maxMvp
	return players.sort((a, b) => score(b) - score(a) || b.mvp - a.mvp ||
		b.captures - a.captures || Number(a.staticId) - Number(b.staticId))
		.map((player, index) => ({ ...player, position: index + 1 }))
}
