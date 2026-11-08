const catalog = require('./templates.json')
const layout = require('../../public/template-layout')
const legacyFields = () => Object.entries(catalog).filter(([key]) => !key.includes('.document')).map(([key, field]) => ({ key, ...field, value: field.default }))
for (const field of layout.documents(legacyFields())) catalog[field.key] = field
const hiddenTemplate = key => /^(panel|archives|unanswered)\./.test(key) || (/^(invite|navigation|application|dm)\./.test(key) && !key.includes('.document') && !['invite.3', 'invite.4', 'application.1', 'application.2', 'application.3'].includes(key)) || /^capture\.(1|4|5|6|queue|main|reserve|left)$/.test(key)
const { defaultRolePrefixes } = require('../utils/adminPrefix')

function templateDefinition(key) {
	if (/^(panel|archives|unanswered)\./.test(key)) return null
	if (Object.hasOwn(catalog, key)) return catalog[key]
	if (key === 'rules.document') return { group: 'Правила', label: 'Правила целиком', type: 'text', maxLength: 4000, variables: [] }
	if (['promotion.document', 'recruit.document'].includes(key)) return { group: key.startsWith('promotion.') ? 'Система повышения' : 'Памятка рекрута', label: 'Текст сообщения (Markdown)', type: 'text', components: true, maxLength: 16000, variables: [], default: key.startsWith('promotion.') ? '# Система повышения' : '# Памятка рекрута' }
	const match = /^rules\.(?:heading\.([1-9]\d*)|rule\.([1-9]\d*)\.([1-9]\d*))$/.exec(key)
	if (!match) return null
	return { group: 'Правила', label: match[1] ? 'Раздел ' + match[1] : 'Правило ' + match[2] + '-' + match[3], type: 'text', maxLength: 4000, variables: [] }
}

const settingDefinitions = {
	INVITE_CATEGORY_ID: { label: 'Категория заявок', type: 'channel', channelTypes: [4] },
	LOG_CHANNEL_ID: { label: 'Канал журнала заявок', type: 'channel', channelTypes: [0] },
	CHANGELOG_CHANNEL_ID: { label: 'Канал журнала изменений', type: 'channel', channelTypes: [0] },
	PARENT_CHANNEL_ID: { label: 'Канал архивов', type: 'channel', channelTypes: [0] },
	ARCHIVE_SETTINGS_CHANNEL: { label: 'Канал списков архивов', type: 'channel', channelTypes: [0] },
	PLUS_CHANNEL_ID: { label: 'Канал регистрации на капт', type: 'channel', channelTypes: [0] },
	CAPT_INFO_CHANNEL_ID: { label: 'Канал объявлений каптов из Majestic API', type: 'channel', channelTypes: [0] },
	ADMIN_ROLES: { label: 'Роли модераторов бота (не дают доступ в дашборд)', type: 'roles' },
	ROLE_PREFIXES: { label: 'Префиксы ролей в никах (приоритет сверху вниз)', type: 'rolePrefixes' },
	MAIN_ROLE_ID: { label: 'Роль после принятия заявки', type: 'role' },
	FAMILY_ADDITIONAL_ROLES: { label: 'Дополнительные роли после принятия', type: 'roles' },
	AUTO_ROLE: { label: 'Роль участников для архивов', type: 'role' },
	ARCHIVE_GROUP_ROLES: { label: 'Группы ролей в архивах', type: 'roles' },
	PRIORITY_ROLES: { label: 'Приоритет ролей на капт (сверху вниз)', type: 'roles' },
	DISCORD_NOTIFICATION_CHANNEL_IDS: { label: 'Каналы массовой Telegram-рассылки', type: 'channels', channelTypes: [0, 5] },
	TELEGRAM_BROADCAST_ENABLED: { label: 'Доставка массовой Telegram-рассылки', type: 'boolean', default: true },
	MAJESTIC_AUTO_NICKNAMES: { label: 'Автосинхронизация ников и рангов Majestic каждые 10 минут', type: 'boolean', default: true },
	DASHBOARD_ALLOW_MENTIONS: { label: 'Разрешить @everyone, @here и пользователей при ручной публикации (роли разрешены всегда)', type: 'boolean', default: false }
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
		if (key === 'ROLE_PREFIXES') return structuredClone(state.settings[key] ?? defaultRolePrefixes(String(getSetting('ADMIN_ROLES')).split(',').map(id => id.trim()).filter(Boolean)))
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
			const generated = key.includes('.document') ? layout.documents(legacyFields().map(field => ({ ...field, value: state.templates[field.key] ?? field.value }))).find(field => field.key === key)?.value : undefined
			let source = (/^(archives|unanswered)\./.test(key) ? undefined : state.templates[key]) ?? generated ?? catalog[key]?.default ?? fallback
			if ((key.includes('.document') || key.startsWith('permanent.')) && typeof source === 'string' && source.includes('<separator')) {
				const markdown = require('../../public/component-markdown')
				const visibleSeparators = /^(promotion|recruit)\.document$|^permanent\.(promotion|recruit)\./.test(key)
				source = markdown.stringify(markdown.parse(source).map(item => visibleSeparators && item.type === 'separator' ? { ...item, divider: true } : item))
			}
			if (typeof source !== 'string') throw new Error(`Unknown template: ${key}`)
			return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) =>
				Object.hasOwn(variables, name) ? String(variables[name]) : match)
		},
		snapshot() {
			const fields = { ...catalog }
			for (const kind of ['promotion', 'recruit']) if (!state.bindings?.[kind]) fields[kind + '.document'] = templateDefinition(kind + '.document')
			for (const key of Object.keys(state.templates)) if (templateDefinition(key)) fields[key] = templateDefinition(key)
			return { revision, bindings: this.bindings, templates: Object.entries(fields).sort(([a], [b]) => {
				if (a.startsWith('rules.') !== b.startsWith('rules.')) return a.startsWith('rules.') ? -1 : 1
				if (a === 'rules.1' || b === 'rules.1') return a === b ? 0 : a === 'rules.1' ? -1 : 1
				const order = key => { const parts = key.split('.'); return [Number(parts[2]), parts[1] === 'heading' ? 0 : Number(parts[3])] }
				if (!/^rules\.(heading|rule)\./.test(a) || !/^rules\.(heading|rule)\./.test(b)) return 0
				const x = order(a), y = order(b)
				return x[0] - y[0] || x[1] - y[1]
			}).filter(([key]) => !hiddenTemplate(key)).map(([key, value]) => ({
				key, ...value, ...(value.type === 'text' ? { components: value.components ?? !(/^navigation\.item\./.test(key) || /^panel\.row\./.test(key) || key === 'invite.3') } : {}), value: this.text(key, {}, value.default)
			})), settings: Object.entries(settingDefinitions).map(([key, value]) => ({ key, ...value, value: getSetting(key) })) }
		},
		async init(database) {
			pool = database
			await pool.query(`CREATE TABLE IF NOT EXISTS dashboard_navigation_messages (
				message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
				container_index INTEGER NOT NULL, prefix_length INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS dashboard_state (
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
		async trackNavigation(message, location) {
			await pool.query(`INSERT INTO dashboard_navigation_messages (message_id, guild_id, channel_id, container_index, prefix_length)
				VALUES ($1, $2, $3, $4, $5) ON CONFLICT (message_id) DO UPDATE SET container_index = EXCLUDED.container_index, prefix_length = EXCLUDED.prefix_length`,
				[message.id, message.guildId || message.guild.id, message.channelId, location.containerIndex, location.prefixLength])
		},
		async navigationMessages(guildId) {
			return (await pool.query('SELECT * FROM dashboard_navigation_messages WHERE guild_id = $1', [guildId])).rows
		},
		async forgetNavigation(messageId) {
			await pool.query('DELETE FROM dashboard_navigation_messages WHERE message_id = $1', [messageId])
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
						if (binding && ['promotion', 'recruit'].includes(kind)) delete next.templates[kind + '.document']
						for (const field of [...(current.value.bindings?.[kind]?.fields || []), ...(binding?.fields || [])]) delete next.templates[field.key]
					}
				}
				for (const [key, value] of Object.entries(values)) {
					if (value === null) {
						delete next[section][key]
						if (section === 'templates' && key.includes('.document') && catalog[key]) {
							for (const legacyKey of Object.keys(next.templates)) if (hiddenTemplate(legacyKey) && catalog[legacyKey]?.group === catalog[key].group) delete next.templates[legacyKey]
						}
					}
					else next[section][key] = value
				}
				const changes = {}
				for (const key of Object.keys(values)) {
					const definition = section === 'templates' ? templateDefinition(key) : settingDefinitions[key]
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
module.exports = { store, createStore, catalog, settingDefinitions, templateDefinition }
