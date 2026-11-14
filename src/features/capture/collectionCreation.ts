export const COLLECTION_CREATION_SCHEMA = `CREATE TABLE IF NOT EXISTS collection_creations (
	creation_key TEXT PRIMARY KEY,
	expires_at TIMESTAMPTZ NOT NULL,
	message_url TEXT
)`

export function collectionCreationError(error: unknown) {
	return 'Не удалось подтвердить создание сбора. Проверьте канал: объявление могло быть отправлено.'
}
