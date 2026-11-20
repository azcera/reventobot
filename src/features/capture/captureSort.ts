import type { Pool, PoolClient } from 'pg'

export function nextCaptureSort(mode: string | null | undefined) {
	if (mode === 'rating') return 'priority'
	if (mode === 'time') return 'rating'
	return 'time'
}

export function captureSortLabel(mode: string | null | undefined) {
	if (mode === 'rating') return 'По рейтингу'
	if (mode === 'time') return 'По времени'
	return 'По приоритету'
}

export const compareCaptureRanks = (a?: number, b?: number) =>
	(a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER)

export async function captureSortPreference(pool: Pool, guildId: string) {
	const { rows } = await pool.query<{ mode: string }>(
		'SELECT mode FROM capture_sort_preferences WHERE guild_id = $1',
		[guildId]
	)
	return rows[0]?.mode ?? 'rating'
}

export async function saveCaptureSort(
	db: Pool | PoolClient,
	guildId: string,
	mode: string
) {
	await db.query(
		`INSERT INTO capture_sort_preferences (guild_id, mode) VALUES ($1, $2)
		ON CONFLICT (guild_id) DO UPDATE SET mode = EXCLUDED.mode`,
		[guildId, mode]
	)
}

