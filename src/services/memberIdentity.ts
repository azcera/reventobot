import type { PoolClient } from 'pg'
import pool = require('./database')

type MemberIdentity = {
	discord_id: string
	game_static: string | null
	archive_thread_id: string | null
}

async function getMemberIdentity(guildId: string, userId: string, db: PoolClient | typeof pool = pool) {
	const { rows } = await db.query<MemberIdentity>(
		`SELECT discord_id, game_static, archive_thread_id FROM guild_member_identities
		WHERE guild_id = $1 AND discord_id = $2`, [guildId, userId]
	)
	return rows[0]
}

async function getMemberArchives(guildId: string) {
	const { rows } = await pool.query<MemberIdentity>(
		`SELECT discord_id, game_static, archive_thread_id FROM guild_member_identities
		WHERE guild_id = $1 AND archive_thread_id IS NOT NULL`, [guildId]
	)
	return rows
}

async function saveMemberStatic(guildId: string, userId: string, gameStatic: string) {
	await pool.query(
		`INSERT INTO guild_member_identities (guild_id, discord_id, game_static) VALUES ($1, $2, $3)
		ON CONFLICT (guild_id, discord_id) DO UPDATE SET game_static = EXCLUDED.game_static
		WHERE guild_member_identities.game_static IS DISTINCT FROM EXCLUDED.game_static`,
		[guildId, userId, gameStatic]
	)
}

async function seedMemberStatics(guildId: string, statics: Map<string, string>) {
	if (!statics.size) return
	await pool.query(
		`INSERT INTO guild_member_identities (guild_id, discord_id, game_static)
		SELECT $1, roster.discord_id, roster.game_static
		FROM UNNEST($2::text[], $3::text[]) AS roster(discord_id, game_static)
		ON CONFLICT (guild_id, discord_id) DO UPDATE SET game_static = EXCLUDED.game_static
		WHERE guild_member_identities.game_static IS NULL`,
		[guildId, [...statics.keys()], [...statics.values()]]
	)
}

async function linkMemberArchive(guildId: string, userId: string, threadId: string,
	gameStatic: string | null, db: PoolClient | typeof pool = pool) {
	const { rows } = await db.query<{ archive_thread_id: string }>(
		`INSERT INTO guild_member_identities (guild_id, discord_id, archive_thread_id, game_static)
		VALUES ($1, $2, $3, $4) ON CONFLICT (guild_id, discord_id) DO UPDATE
		SET archive_thread_id = EXCLUDED.archive_thread_id,
		game_static = COALESCE(guild_member_identities.game_static, EXCLUDED.game_static)
		WHERE guild_member_identities.archive_thread_id IS NULL
		RETURNING archive_thread_id`, [guildId, userId, threadId, gameStatic]
	)
	return rows.length > 0
}

async function unlinkMemberArchive(guildId: string, threadId: string, db: PoolClient | typeof pool = pool) {
	await db.query(`UPDATE guild_member_identities SET archive_thread_id = NULL
		WHERE guild_id = $1 AND archive_thread_id = $2`, [guildId, threadId])
}

async function withMemberArchiveLock<T>(guildId: string, userId: string, work: (db: PoolClient) => Promise<T>) {
	const db = await pool.connect()
	try {
		await db.query('BEGIN')
		await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`archive:${guildId}:${userId}`])
		const result = await work(db)
		await db.query('COMMIT')
		return result
	} catch (error) {
		await db.query('ROLLBACK').catch(() => {})
		throw error
	} finally {
		db.release()
	}
}

export { getMemberIdentity, getMemberArchives, saveMemberStatic, seedMemberStatics, linkMemberArchive, unlinkMemberArchive, withMemberArchiveLock }
