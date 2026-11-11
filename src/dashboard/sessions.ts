import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
// Only hashes of the opaque browser tokens are stored. OAuth access tokens are not retained.
interface Session { user: T.Actor; csrf: string; expires: number }
function createSessions(pool: Pg.Pool | undefined, { clientId, guildId }: { clientId?: string; guildId?: string }) {
	if (!pool) {
		const sessions = new Map<string, Session>()
		return {
			async get(key: string) { const value = sessions.get(key); if (value && value.expires > Date.now()) return value; sessions.delete(key) },
			async set(key: string, value: Session) { for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id); sessions.set(key, value) },
			async delete(key: string) { sessions.delete(key) }
		}
	}
	let ready
	const init = () => ready ||= pool.query(`CREATE TABLE IF NOT EXISTS dashboard_sessions (
		token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, guild_id TEXT NOT NULL,
		user_data JSONB NOT NULL, csrf TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
	); CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry ON dashboard_sessions (expires_at)`)
		.catch(error => { ready = null; throw error })
	return {
		async get(key: string) {
			await init()
			const { rows } = await pool.query('SELECT user_data, csrf, expires_at FROM dashboard_sessions WHERE token_hash = $1 AND client_id = $2 AND guild_id = $3 AND expires_at > NOW()', [key, clientId, guildId])
			if (rows[0]) return { user: rows[0].user_data, csrf: rows[0].csrf, expires: new Date(rows[0].expires_at).getTime() }
		},
		async set(key: string, value: Session) {
			await init()
			await pool.query('DELETE FROM dashboard_sessions WHERE expires_at <= NOW()')
			await pool.query('INSERT INTO dashboard_sessions (token_hash, client_id, guild_id, user_data, csrf, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [key, clientId, guildId, JSON.stringify(value.user), value.csrf, new Date(value.expires)])
		},
		async delete(key: string) {
			await init()
			await pool.query('DELETE FROM dashboard_sessions WHERE token_hash = $1 AND client_id = $2 AND guild_id = $3', [key, clientId, guildId])
		}
	}
}

export { createSessions }
