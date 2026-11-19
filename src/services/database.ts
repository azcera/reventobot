import { readFileSync } from 'node:fs'
import { checkServerIdentity } from 'node:tls'
import { Pool } from 'pg'

const pool = new Pool({
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 10000
})

pool.on('error', err => {
	console.error('Непредвиденная ошибка на незанятом клиенте PostgreSQL:', err)
})

async function initDb() {
	const connectionString = process.env.SUPABASE_URL || process.env.DATABASE_URL
	if (!connectionString)
		throw new Error('Укажите DATABASE_URL или SUPABASE_URL.')
	let url: URL
	try {
		url = new URL(connectionString)
	} catch {
		throw new Error('Некорректный URL PostgreSQL.')
	}
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
		throw new Error('Укажите TCP-адрес PostgreSQL.')
	for (const key of url.searchParams.keys()) {
		if (
			/^ssl/i.test(key) &&
			(key !== 'sslmode' ||
				url.searchParams.getAll(key).some(mode => mode !== 'verify-full'))
		) {
			throw new Error(
				'Уберите параметры SSL из URL PostgreSQL. Для CA используйте DATABASE_CA_FILE.'
			)
		}
	}
	url.searchParams.delete('sslmode')
	const host = url.hostname.replace(/^\[|\]$/g, '')
	const local = ['localhost', '127.0.0.1', '::1'].includes(host)
	const disableTls = process.env.DATABASE_TLS === 'disable'
	if (
		disableTls &&
		(!local ||
			process.env.NODE_ENV === 'production' ||
			url.searchParams.has('host'))
	) {
		throw new Error(
			'DATABASE_TLS=disable разрешён только для локальной разработки.'
		)
	}
	if (url.searchParams.has('host'))
		throw new Error('Укажите хост PostgreSQL в основной части URL.')
	const caFile = process.env.DATABASE_CA_FILE
	Object.assign(pool.options, {
		connectionString: url.href,
		ssl: disableTls
			? false
			: {
					rejectUnauthorized: true,
					checkServerIdentity: (
						_: string,
						certificate: Parameters<typeof checkServerIdentity>[1]
					) => checkServerIdentity(host, certificate),
					...(caFile ? { ca: readFileSync(caFile) } : {})
				}
	})
	await pool.query(
		(
			require('../features/capture/collectionCreation') as typeof import('../features/capture/collectionCreation')
		).COLLECTION_CREATION_SCHEMA
	)
	await pool.query(
		(require('./familyWars') as typeof import('./familyWars')).FAMILY_WAR_SCHEMA
	)
	await pool.query(`
            CREATE TABLE IF NOT EXISTS family_applications (
                user_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                full_name TEXT NOT NULL,
                age INT NOT NULL,
                about_and_expectations TEXT NOT NULL,
                previous_experience TEXT NOT NULL,  
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `)

	await pool.query(`
            CREATE TABLE IF NOT EXISTS active_captures (
                message_id TEXT PRIMARY KEY,
                discord_timestamp TEXT,
                main_list JSONB,
                reserve_list JSONB,
                left_list JSONB,
                main_list_meta JSONB,
                reserve_list_meta JSONB,
                target TEXT,
                max_main INTEGER DEFAULT 20
            );
        `)

	await pool.query(`ALTER TABLE active_captures
		ADD COLUMN IF NOT EXISTS channel_id TEXT,
		ADD COLUMN IF NOT EXISTS controls_closed BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS closure_pending BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS message_refresh_pending BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS message_revision BIGINT NOT NULL DEFAULT 0,
		ADD COLUMN IF NOT EXISTS main_list_meta JSONB,
		ADD COLUMN IF NOT EXISTS reserve_list_meta JSONB,
		ADD COLUMN IF NOT EXISTS approved_users JSONB NOT NULL DEFAULT '[]'::jsonb,
		ADD COLUMN IF NOT EXISTS approval_page INTEGER NOT NULL DEFAULT 0,
		ADD COLUMN IF NOT EXISTS sort_mode TEXT NOT NULL DEFAULT 'priority'`)

	await pool.query(`CREATE INDEX IF NOT EXISTS active_captures_pending_controls_idx
		ON active_captures (message_id) WHERE controls_closed = FALSE OR closure_pending OR message_refresh_pending`)

	// types: unanswered, all, unused
	await pool.query(`
            CREATE TABLE IF NOT EXISTS settings_archive_messages (
                message_id TEXT PRIMARY KEY,
                discord_timestamp TEXT,
                type TEXT, 
                part INTEGER DEFAULT 1
            );
        `)
	await pool.query(`ALTER TABLE family_applications
		ADD COLUMN IF NOT EXISTS guild_id TEXT,
		ADD COLUMN IF NOT EXISTS creation_id TEXT,
		ADD COLUMN IF NOT EXISTS message_id TEXT,
		ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
	await pool.query(`ALTER TABLE settings_archive_messages
		ADD COLUMN IF NOT EXISTS guild_id TEXT,
		ADD COLUMN IF NOT EXISTS channel_id TEXT`)

	await pool.query(`CREATE TABLE IF NOT EXISTS telegram_capture_deliveries (
		source TEXT PRIMARY KEY, marker INTEGER NOT NULL, notice JSONB NOT NULL, payload JSONB NOT NULL,
		channel_id TEXT, message_id TEXT, started_at TIMESTAMPTZ, tracked_at TIMESTAMPTZ,
		retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);
	CREATE INDEX IF NOT EXISTS telegram_capture_deliveries_pending_idx ON telegram_capture_deliveries (retry_at) WHERE tracked_at IS NULL`)
	await pool.query(`CREATE TABLE IF NOT EXISTS telegram_notification_queue (
		message_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, text TEXT NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0, retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		lease_until TIMESTAMPTZ, lease_token UUID, completed_at TIMESTAMPTZ, failed BOOLEAN NOT NULL DEFAULT FALSE
	);
	CREATE INDEX IF NOT EXISTS telegram_notification_queue_pending_idx ON telegram_notification_queue (retry_at) WHERE completed_at IS NULL`)

	console.log('✅ Все таблицы БД успешно проверены и инициализированы.')
}

export = Object.assign(pool, { initDb })
