import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

export const COLLECTION_CREATION_SCHEMA = `CREATE TABLE IF NOT EXISTS collection_creations (
	creation_key TEXT PRIMARY KEY,
	expires_at TIMESTAMPTZ NOT NULL,
	message_url TEXT
)`

export class DuplicateCollectionError extends Error {}

// Claim before sending: an uncertain Discord response must not cause a second publication.
export async function publishCollectionOnce(pool: Pick<Pool, 'query'>, identity: unknown[], expiresAt: number, publish: () => Promise<string>) {
	const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
	const claim = await pool.query(`INSERT INTO collection_creations (creation_key, expires_at)
		VALUES ($1, $2) ON CONFLICT (creation_key) DO UPDATE
		SET expires_at = EXCLUDED.expires_at, message_url = NULL
		WHERE collection_creations.expires_at <= NOW() RETURNING creation_key`, [key, new Date(Date.now() + 10 * 60000)])
	if (!claim.rows.length) {
		const { rows } = await pool.query('SELECT message_url FROM collection_creations WHERE creation_key = $1', [key])
		throw new DuplicateCollectionError(rows[0]?.message_url
			? `Этот сбор уже создан: ${rows[0].message_url}`
			: 'Этот сбор уже создаётся или результат предыдущей отправки не подтверждён. Проверьте канал перед повтором.')
	}
	const url = await publish()
	await pool.query('UPDATE collection_creations SET message_url = $2, expires_at = $3 WHERE creation_key = $1', [key, url, new Date(Math.max(expiresAt, Date.now() + 10 * 60000))])
	return url
}

export function collectionCreationError(error: unknown) {
	return error instanceof DuplicateCollectionError ? error.message
		: 'Не удалось подтвердить создание сбора. Проверьте канал: объявление могло быть отправлено. Повторная отправка этого сбора временно заблокирована.'
}
