const catalog = require('./templates.json')

const settingDefinitions = {
	ADMIN_PANEL_CHANNEL_ID: { label: 'Канал админ-панели', type: 'channel', channelTypes: [0] },
	INVITE_CATEGORY_ID: { label: 'Категория заявок', type: 'channel', channelTypes: [4] },
	LOG_CHANNEL_ID: { label: 'Канал журнала заявок', type: 'channel', channelTypes: [0] },
	CHANGELOG_CHANNEL_ID: { label: 'Канал журнала изменений', type: 'channel', channelTypes: [0] },
	PARENT_CHANNEL_ID: { label: 'Канал архивов', type: 'channel', channelTypes: [0] },
	ARCHIVE_SETTINGS_CHANNEL: { label: 'Канал списков архивов', type: 'channel', channelTypes: [0] },
	PLUS_CHANNEL_ID: { label: 'Канал регистрации на капт', type: 'channel', channelTypes: [0] },
	ADMIN_ROLES: { label: 'Роли модераторов бота (не дают доступ в дашборд)', type: 'roles' },
	MAIN_ROLE_ID: { label: 'Роль после принятия заявки', type: 'role' },
	FAMILY_ADDITIONAL_ROLES: { label: 'Дополнительные роли после принятия', type: 'roles' },
	AUTO_ROLE: { label: 'Роль участников для архивов', type: 'role' },
	ARCHIVE_GROUP_ROLES: { label: 'Группы ролей в архивах', type: 'roles' },
	PRIORITY_ROLES: { label: 'Приоритет ролей на капт (сверху вниз)', type: 'roles' },
	DISCORD_NOTIFICATION_CHANNEL_IDS: { label: 'Каналы массовой Telegram-рассылки', type: 'channels', channelTypes: [0, 5] },
	TELEGRAM_BROADCAST_ENABLED: { label: 'Доставка массовой Telegram-рассылки', type: 'boolean', default: true },
	DASHBOARD_ALLOW_MENTIONS: { label: 'Разрешить @everyone и роли при ручной публикации', type: 'boolean', default: false }
}

function refreshBoundFields(state) {
	for (const key of Object.keys(catalog)) if (key.startsWith('permanent.')) delete catalog[key]
	for (const binding of Object.values(state.bindings || {})) for (const field of binding.fields || []) catalog[field.key] = field
}

function createStore() {
	let state = { templates: {}, settings: {} }
	let revision = 0
	let pool
	let ready = false
	const getSetting = key => {
		const value = Object.hasOwn(state.settings, key) ? state.settings[key]
			: process.env[key] ?? settingDefinitions[key]?.default ?? ''
		return settingDefinitions[key]?.type === 'boolean' ? value === true || value === 'true' : value
	}
	return {
		get ready() { return ready },
		get revision() { return revision },
		getSetting,
		get bindings() { return structuredClone(state.bindings || {}) },
		roleIds(key) { return String(getSetting(key)).split(',').map(id => id.trim()).filter(Boolean) },
		decorate(key, container) {
			return container.clearAccentColor()
		},
		text(key, variables = {}, fallback) {
			const source = state.templates[key] ?? catalog[key]?.default ?? fallback
			if (typeof source !== 'string') throw new Error(`Unknown template: ${key}`)
			return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) =>
				Object.hasOwn(variables, name) ? String(variables[name]) : match)
		},
		snapshot() {
			return { revision, bindings: this.bindings, templates: Object.entries(catalog).map(([key, value]) => ({
				key, ...value, value: state.templates[key] ?? value.default
			})), settings: Object.entries(settingDefinitions).map(([key, value]) => ({ key, ...value, value: getSetting(key) })) }
		},
		async init(database) {
			pool = database
			await pool.query(`CREATE TABLE IF NOT EXISTS dashboard_state (
				id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0,
				value JSONB NOT NULL DEFAULT '{"templates":{},"settings":{}}'
			);
			CREATE TABLE IF NOT EXISTS dashboard_audit (
				id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details JSONB NOT NULL
			);
			INSERT INTO dashboard_state (id) VALUES (1) ON CONFLICT DO NOTHING`)
			const result = await pool.query('SELECT revision, value FROM dashboard_state WHERE id = 1')
			state = result.rows[0].value
			refreshBoundFields(state)
			revision = result.rows[0].revision
			ready = true
		},
		async save(section, values, expectedRevision, actor) {
			const db = await pool.connect()
			try {
				await db.query('BEGIN')
				const result = await db.query('SELECT revision, value FROM dashboard_state WHERE id = 1 FOR UPDATE')
				const current = result.rows[0]
				if (current.revision !== expectedRevision) {
					state = current.value
					refreshBoundFields(state)
					revision = current.revision
					throw Object.assign(new Error('Настройки изменены другим пользователем. Обновите страницу.'), { status: 409 })
				}
				const next = { ...current.value, [section]: { ...current.value[section] } }
				if (section === 'bindings') {
					next.templates = { ...current.value.templates }
					for (const [kind, binding] of Object.entries(values)) {
						for (const field of [...(current.value.bindings?.[kind]?.fields || []), ...(binding?.fields || [])]) delete next.templates[field.key]
					}
				}
				for (const [key, value] of Object.entries(values)) {
					if (value === null) delete next[section][key]
					else next[section][key] = value
				}
				const changes = {}
				for (const key of Object.keys(values)) {
					const definition = section === 'templates' ? catalog[key] : settingDefinitions[key]
					const fallback = section === 'settings' ? process.env[key] ?? definition?.default ?? '' : definition?.default
					const before = current.value[section]?.[key] ?? fallback
					const after = next[section]?.[key] ?? fallback
					if (JSON.stringify(before) !== JSON.stringify(after)) changes[key] = section === 'bindings'
						? { label: ({ rules: 'Привязка правил', invite: 'Привязка приглашения', promotion: 'Привязка системы повышения', recruit: 'Привязка памятки рекрута' })[key] || key, before: before?.link || null, after: after?.link || null }
						: { label: definition?.label || key, before, after }
				}
				await db.query('UPDATE dashboard_state SET value = $1::jsonb, revision = revision + 1 WHERE id = 1', [JSON.stringify(next)])
				await db.query('INSERT INTO dashboard_audit (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)',
					[actor?.id || actor, section, Object.keys(values).join(', '), JSON.stringify({ actorName: actor?.name, fields: changes })])
				await db.query('COMMIT')
				state = next
				refreshBoundFields(state)
				revision = current.revision + 1
				return revision
			} catch (error) {
				await db.query('ROLLBACK')
				throw error
			} finally { db.release() }
		},
		async audit(actor, action, target, details = {}) {
			await pool.query('INSERT INTO dashboard_audit (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)',
				[actor?.id || actor, action, target, JSON.stringify({ ...details, actorName: actor?.name || details.actorName })])
		},
		async history() {
			return (await pool.query('SELECT id, created_at, actor, action, target, details FROM dashboard_audit ORDER BY id DESC LIMIT 100')).rows
		}
	}
}

const store = createStore()
module.exports = { store, createStore, catalog, settingDefinitions }
