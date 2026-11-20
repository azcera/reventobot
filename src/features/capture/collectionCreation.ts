import type { Client, Message } from 'discord.js'
import type { Pool } from 'pg'

export const COLLECTION_CREATION_SCHEMA = `CREATE TABLE IF NOT EXISTS collection_creations (
	creation_key TEXT PRIMARY KEY,
	expires_at TIMESTAMPTZ NOT NULL,
	message_url TEXT
);
ALTER TABLE collection_creations ADD COLUMN IF NOT EXISTS channel_id TEXT,
	ADD COLUMN IF NOT EXISTS guild_id TEXT,
	ADD COLUMN IF NOT EXISTS discord_timestamp TEXT,
	ADD COLUMN IF NOT EXISTS target TEXT,
	ADD COLUMN IF NOT EXISTS max_main INTEGER,
	ADD COLUMN IF NOT EXISTS sort_mode TEXT NOT NULL DEFAULT 'priority',
	ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ
`

export function collectionCreationError(error: unknown) {
	return 'Не удалось подтвердить создание сбора. Проверьте канал: объявление могло быть отправлено.'
}

export const collectionSortId = 'capt_sort_toggle'
export const isCollectionSort = (id: string) =>
	id === collectionSortId || id.startsWith(collectionSortId + ':')

export async function completeCollectionCreation(
	pool: Pool,
	key: string,
	message: Message
) {
	const { rows } = await pool.query(
		`WITH operation AS (
		UPDATE collection_creations SET message_url = $3 WHERE creation_key = $1 AND message_url IS NULL
		RETURNING channel_id, discord_timestamp, target, max_main, sort_mode
	)
	INSERT INTO active_captures (message_id, discord_timestamp, main_list, reserve_list, left_list,
		main_list_meta, reserve_list_meta, target, max_main, channel_id, sort_mode)
	SELECT $2, discord_timestamp, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
		target, max_main, channel_id, sort_mode FROM operation RETURNING message_id`,
		[key, message.id, message.url]
	)
	return rows.length > 0
}

export async function recoverCollectionCreations(client: Client, pool: Pool) {
	const { rows } = await pool.query<{
		creation_key: string
		channel_id: string
		guild_id: string
	}>(`
		SELECT creation_key, channel_id, guild_id FROM collection_creations
		WHERE message_url IS NULL AND channel_id IS NOT NULL
		AND (reconciled_at IS NULL OR reconciled_at < NOW() - INTERVAL '5 minutes')
		ORDER BY reconciled_at NULLS FIRST, creation_key LIMIT 25`)
	for (const {
		creation_key: key,
		channel_id: channelId,
		guild_id: guildId
	} of rows) {
		try {
			const channel = await client.channels.fetch(channelId)
			if (
				!channel?.isTextBased() ||
				!('guildId' in channel) ||
				channel.guildId !== guildId
			)
				continue
			const marker = collectionSortId + ':' + key
			let after = key
			for (;;) {
				const batch = await channel.messages.fetch({
					after,
					limit: 100,
					cache: false
				})
				const message = batch.find(
					candidate =>
						candidate.author.id === client.user?.id &&
						!candidate.webhookId &&
						candidate.components.some(
							container =>
								container.type === 17 &&
								container.components.some(
									component =>
										component.type === 1 &&
										component.components.some(
											button =>
												button.type === 2 &&
												'customId' in button &&
												button.customId === marker
										)
								)
						)
				)
				if (message) {
					await completeCollectionCreation(pool, key, message)
					break
				}
				if (batch.size < 100) break
				const latest = [...batch.keys()].reduce((a, b) =>
					BigInt(a) > BigInt(b) ? a : b
				)
				if (BigInt(latest) <= BigInt(after))
					throw new Error('Не удалось прочитать историю сборов.')
				after = latest
			}
			await pool.query(
				'UPDATE collection_creations SET reconciled_at = NOW() WHERE creation_key = $1',
				[key]
			)
		} catch (error) {
			console.error('[Collection creation recovery]', error)
		}
	}
}
