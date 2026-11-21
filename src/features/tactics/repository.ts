import type { Pool } from 'pg'
import type { Board, BoardObject, MapInfo, MapPage, TacticInfo } from '../../../shared/tactics'

export const mapUploadLimit = 12 * 1024 * 1024
const mapColumns = 'id, name, width, height, archived, sort_order AS "order"'
const pageSize = 40

export async function initTactics(pool: Pool) {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS tactics_maps (
			guild_id TEXT NOT NULL,
			id UUID NOT NULL DEFAULT gen_random_uuid(),
			name TEXT NOT NULL,
			width INTEGER NOT NULL,
			height INTEGER NOT NULL,
			image BYTEA NOT NULL,
			archived BOOLEAN NOT NULL DEFAULT FALSE,
			PRIMARY KEY (guild_id, id)
		);
		ALTER TABLE tactics_maps ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
		CREATE INDEX IF NOT EXISTS tactics_maps_order_idx ON tactics_maps (guild_id, sort_order, id);
		CREATE TABLE IF NOT EXISTS tactics_presets (
			guild_id TEXT NOT NULL,
			id UUID NOT NULL DEFAULT gen_random_uuid(),
			map_id UUID NOT NULL,
			author_id TEXT NOT NULL,
			name TEXT NOT NULL,
			snapshot JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (guild_id, id),
			FOREIGN KEY (guild_id, map_id) REFERENCES tactics_maps (guild_id, id)
		);
		CREATE INDEX IF NOT EXISTS tactics_presets_map_idx
			ON tactics_presets (guild_id, map_id, created_at DESC)
	`)
}

export function tacticsRepository(pool: Pool) {
	return {
		async maps(guildId: string, cursor: string | null, search: string, includeArchived: boolean): Promise<MapPage> {
			const { rows } = await pool.query<MapInfo>(`
				SELECT ${mapColumns} FROM tactics_maps
				WHERE guild_id = $1 AND ($2::uuid IS NULL OR (sort_order, id) >
					(COALESCE((SELECT sort_order FROM tactics_maps WHERE guild_id = $1 AND id = $2), 0), $2))
					AND ($3 OR NOT archived OR EXISTS (
						SELECT 1 FROM tactics_presets p
						WHERE p.guild_id = tactics_maps.guild_id AND p.map_id = tactics_maps.id
					)) AND strpos(lower(name), lower($4)) > 0
				ORDER BY sort_order, id LIMIT $5`, [guildId, cursor, includeArchived, search, pageSize + 1])
			const maps = rows.slice(0, pageSize)
			return { maps, next: rows.length > pageSize ? maps.at(-1)!.id : null }
		},
		async map(guildId: string, id: string) {
			const { rows } = await pool.query<MapInfo>(
				`SELECT ${mapColumns} FROM tactics_maps WHERE guild_id = $1 AND id = $2`, [guildId, id])
			return rows[0]
		},
		async image(guildId: string, id: string) {
			const { rows } = await pool.query<{ image: Buffer }>(
				'SELECT image FROM tactics_maps WHERE guild_id = $1 AND id = $2', [guildId, id])
			return rows[0]?.image
		},
		async createMap(guildId: string, name: string, width: number, height: number, image: Buffer) {
			const { rows } = await pool.query<MapInfo>(`
				INSERT INTO tactics_maps (guild_id, name, width, height, image)
				VALUES ($1, $2, $3, $4, $5) RETURNING ${mapColumns}`, [guildId, name, width, height, image])
			return rows[0]!
		},
		async archive(guildId: string, id: string, archived: boolean) {
			const { rows } = await pool.query<MapInfo>(
				`UPDATE tactics_maps SET archived = $3 WHERE guild_id = $1 AND id = $2 RETURNING ${mapColumns}`, [guildId, id, archived])
			return rows[0]
		},
		async update(guildId: string, id: string, name: string, order: number, replacement?: {
			data: Buffer; info: { width: number; height: number }
		}) {
			const { rows } = await pool.query<MapInfo>(`
				UPDATE tactics_maps SET name = $3, sort_order = $4,
					image = COALESCE($5, image), width = COALESCE($6, width), height = COALESCE($7, height)
				WHERE guild_id = $1 AND id = $2 RETURNING ${mapColumns}`,
			[guildId, id, name, order, replacement?.data, replacement?.info.width, replacement?.info.height])
			return rows[0]
		},
		async delete(guildId: string, id: string) {
			const { rowCount } = await pool.query('DELETE FROM tactics_maps WHERE guild_id = $1 AND id = $2', [guildId, id])
			return rowCount === 1
		},
		async presets(guildId: string, mapId: string) {
			const { rows } = await pool.query<TacticInfo>(`
				SELECT id, name FROM tactics_presets WHERE guild_id = $1 AND map_id = $2
				ORDER BY created_at DESC, id`, [guildId, mapId])
			return rows
		},
		async preset(guildId: string, id: string) {
			const { rows } = await pool.query<{ mapId: string; snapshot: { version: number; objects: BoardObject[] } }>(
				'SELECT map_id AS "mapId", snapshot FROM tactics_presets WHERE guild_id = $1 AND id = $2',
				[guildId, id])
			return rows[0]
		},
		async save(guildId: string, userId: string, name: string, board: Board) {
			const version = board.objects.some(object => object.type === 'arrow') ? 2 : 1
			const { rows } = await pool.query<TacticInfo>(`
				INSERT INTO tactics_presets (guild_id, map_id, author_id, name, snapshot)
				VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
			[guildId, board.map!.id, userId, name, JSON.stringify({ version, objects: board.objects })])
			return rows[0]!
		}
	}
}
