import type { Pool, PoolClient } from 'pg'
import type { Board, BoardObject, CatalogMap, MapCategory, MapCatalog, MapInfo, MapOrder, MapPage, TacticInfo } from '../../../shared/tactics'

export const mapUploadLimit = 12 * 1024 * 1024
const mapColumns = 'id, name, width, height, category_id AS "categoryId"'
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
			PRIMARY KEY (guild_id, id)
		);
		ALTER TABLE tactics_maps ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
		CREATE TABLE IF NOT EXISTS tactics_categories (
			guild_id TEXT NOT NULL,
			id UUID NOT NULL DEFAULT gen_random_uuid(),
			name TEXT NOT NULL,
			PRIMARY KEY (guild_id, id)
		);
		CREATE UNIQUE INDEX IF NOT EXISTS tactics_categories_name_idx ON tactics_categories (guild_id, lower(name));
		ALTER TABLE tactics_maps ADD COLUMN IF NOT EXISTS category_id UUID;
		INSERT INTO tactics_categories (guild_id, name)
			SELECT DISTINCT guild_id, 'Капт' FROM tactics_maps WHERE category_id IS NULL ON CONFLICT DO NOTHING;
		UPDATE tactics_maps m SET category_id = c.id FROM tactics_categories c
			WHERE m.guild_id = c.guild_id AND m.category_id IS NULL AND lower(c.name) = lower('Капт');
		CREATE INDEX IF NOT EXISTS tactics_maps_category_order_idx ON tactics_maps (guild_id, category_id, sort_order, id);
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
	async function transaction<Result>(work: (db: PoolClient) => Promise<Result>) {
		const db = await pool.connect()
		try {
			await db.query('BEGIN')
			const result = await work(db)
			await db.query('COMMIT')
			return result
		} catch (error) {
			await db.query('ROLLBACK')
			throw error
		} finally {
			db.release()
		}
	}

	async function lockCategory(db: PoolClient, guildId: string, categoryId: string) {
		const { rowCount } = await db.query(
			'SELECT 1 FROM tactics_categories WHERE guild_id = $1 AND id = $2 FOR UPDATE', [guildId, categoryId])
		return rowCount === 1
	}

	async function categories(guildId: string) {
		const { rows } = await pool.query<MapCategory>(
			'SELECT id, name FROM tactics_categories WHERE guild_id = $1 ORDER BY lower(name), id', [guildId])
		return rows
	}

	return {
		categories,
		async createCategory(guildId: string, name: string) {
			const { rows } = await pool.query<MapCategory>(
				'INSERT INTO tactics_categories (guild_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name',
				[guildId, name])
			return rows[0]
		},
		async catalog(guildId: string): Promise<MapCatalog> {
			const [items, { rows }] = await Promise.all([categories(guildId), pool.query<CatalogMap>(`
				SELECT ${mapColumns}, COALESCE((
					SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.created_at DESC, p.id)
					FROM tactics_presets p WHERE p.guild_id = m.guild_id AND p.map_id = m.id
				), '[]'::jsonb) AS tactics
				FROM tactics_maps m WHERE guild_id = $1 ORDER BY sort_order, id`, [guildId])])
			return { categories: items, maps: rows }
		},
		async maps(guildId: string, cursor: string | null, search: string, categoryId: string | null): Promise<MapPage> {
			const { rows } = await pool.query<MapInfo>(`
				SELECT ${mapColumns} FROM tactics_maps
				WHERE guild_id = $1 AND ($2::uuid IS NULL OR (sort_order, id) >
					(COALESCE((SELECT sort_order FROM tactics_maps WHERE guild_id = $1 AND id = $2), 0), $2))
					AND ($3::uuid IS NULL OR category_id = $3) AND strpos(lower(name), lower($4)) > 0
				ORDER BY sort_order, id LIMIT $5`, [guildId, cursor, categoryId, search, pageSize + 1])
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
		async createMap(guildId: string, categoryId: string, name: string, width: number, height: number, image: Buffer) {
			return transaction(async db => {
				if (!await lockCategory(db, guildId, categoryId)) return undefined
				const { rows } = await db.query<MapInfo>(`
					INSERT INTO tactics_maps (guild_id, category_id, name, width, height, image, sort_order)
					SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(sort_order), 0) + 1
					FROM tactics_maps WHERE guild_id = $1 AND category_id = $2 RETURNING ${mapColumns}`,
				[guildId, categoryId, name, width, height, image])
				return rows[0]
			})
		},
		async update(guildId: string, id: string, name: string, categoryId: string, replacement?: {
			data: Buffer; info: { width: number; height: number }
		}) {
			return transaction(async db => {
				if (!await lockCategory(db, guildId, categoryId)) return undefined
				const { rows } = await db.query<MapInfo>(`
					UPDATE tactics_maps SET name = $3, category_id = $4,
						sort_order = CASE WHEN category_id = $4 THEN sort_order ELSE
							(SELECT COALESCE(MAX(other.sort_order), 0) + 1 FROM tactics_maps other
								WHERE other.guild_id = $1 AND other.category_id = $4) END,
						image = COALESCE($5, image), width = COALESCE($6, width), height = COALESCE($7, height)
					WHERE guild_id = $1 AND id = $2 RETURNING ${mapColumns}`,
				[guildId, id, name, categoryId, replacement?.data, replacement?.info.width, replacement?.info.height])
				return rows[0]
			})
		},
		async reorder(guildId: string, orders: MapOrder[]) {
			return transaction(async db => {
				const categories = orders.map(order => order.categoryId).sort()
				for (const categoryId of categories)
					if (!await lockCategory(db, guildId, categoryId)) return false
				const { rows } = await db.query<{ id: string; categoryId: string }>(`
					SELECT id, category_id AS "categoryId" FROM tactics_maps
					WHERE guild_id = $1 AND category_id = ANY($2::uuid[])
					ORDER BY category_id, sort_order, id FOR UPDATE`, [guildId, categories])
				const current = new Map<string, string[]>()
				for (const row of rows) {
					const ids = current.get(row.categoryId) ?? []
					ids.push(row.id)
					current.set(row.categoryId, ids)
				}
				for (const { categoryId, previous, ids } of orders) {
					const actual = current.get(categoryId)
					if (actual?.length !== previous.length ||
						(!previous.every((id, index) => id === actual[index]) && !ids.every((id, index) => id === actual[index])))
						return false
				}
				await db.query(`
					UPDATE tactics_maps m SET sort_order = positions.position
					FROM unnest($2::uuid[], $3::uuid[], $4::integer[]) AS positions(category_id, id, position)
					WHERE m.guild_id = $1 AND m.category_id = positions.category_id AND m.id = positions.id
						AND m.sort_order <> positions.position`, [
					guildId,
					orders.flatMap(({ categoryId, ids }) => ids.map(() => categoryId)),
					orders.flatMap(({ ids }) => ids),
					orders.flatMap(({ ids }) => ids.map((_, index) => index + 1))
				])
				return true
			})
		},
		async delete(guildId: string, id: string) {
			return transaction(async db => {
				const keys = [guildId, id]
				const locked = await db.query('SELECT 1 FROM tactics_maps WHERE guild_id = $1 AND id = $2 FOR UPDATE', keys)
				if (!locked.rowCount) return false
				await db.query('DELETE FROM tactics_presets WHERE guild_id = $1 AND map_id = $2', keys)
				await db.query('DELETE FROM tactics_maps WHERE guild_id = $1 AND id = $2', keys)
				return true
			})
		},
		async deletePreset(guildId: string, mapId: string, id: string) {
			const { rowCount } = await pool.query(
				'DELETE FROM tactics_presets WHERE guild_id = $1 AND map_id = $2 AND id = $3', [guildId, mapId, id])
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
