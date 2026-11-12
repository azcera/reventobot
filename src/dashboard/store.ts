import { replaceTemplateVariables } from '../../shared/templateVariables'
import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import type { Actor, Binding, CapturePreset, DashboardState, MclList, RolePrefix, SettingDefinition, SettingValue, TemplateField } from '../types'
import type { Pool } from 'pg'
import type { ContainerBuilder, Message } from 'discord.js'
import rawCatalog = require('./templates.json')
const catalog: Record<string, TemplateField> = rawCatalog
import layout = require('../../public/template-layout')
const legacyFields = () => Object.entries(catalog).filter(([key]) => !key.includes('.document')).map(([key, field]) => ({ ...field, key, value: field.default ?? '' }))
for (const field of layout.documents(legacyFields())) catalog[field.key!] = field as TemplateField
const retiredEventField = (key: string) => key.startsWith('schedule.') && key !== 'schedule.banner' || key.startsWith('announcement.') && key !== 'announcement.document'
const hiddenTemplate = (key: string) => retiredEventField(key) || /^(panel|archives|unanswered)\./.test(key) || (/^(invite|navigation|application|dm)\./.test(key) && !key.includes('.document') && !['invite.3', 'invite.4', 'application.1', 'application.2', 'application.3'].includes(key)) || /^capture\.(1|4|5|6|queue|main|reserve|left)$/.test(key)
import { defaultRolePrefixes } from '../utils/adminPrefix'

function templateDefinition(key: string): TemplateField | null {
	if (retiredEventField(key) || /^(panel|archives|unanswered)\./.test(key)) return null
	if (Object.hasOwn(catalog, key)) return catalog[key]
	if (key === 'rules.document') return { group: 'Правила', label: 'Правила целиком', type: 'text', maxLength: 4000, variables: [] }
	if (['promotion.document', 'recruit.document'].includes(key)) return { group: key.startsWith('promotion.') ? 'Система повышения' : 'Памятка рекрута', label: 'Текст сообщения (Markdown)', type: 'text', components: true, maxLength: 16000, variables: [], default: key.startsWith('promotion.') ? '# Система повышения' : '# Памятка рекрута' }
	const match = /^rules\.(?:heading\.([1-9]\d*)|rule\.([1-9]\d*)\.([1-9]\d*))$/.exec(key)
	if (!match) return null
	return { group: 'Правила', label: match[1] ? 'Раздел ' + match[1] : 'Правило ' + match[2] + '-' + match[3], type: 'text', maxLength: 4000, variables: [] }
}

const settingDefinitions: Record<string, SettingDefinition> = {
	INVITE_CATEGORY_ID: { label: 'Категория заявок', type: 'channel', channelTypes: [4] },
	LOG_CHANNEL_ID: { label: 'Канал журнала заявок', type: 'channel', channelTypes: [0] },
	CHANGELOG_CHANNEL_ID: { label: 'Канал журнала изменений', type: 'channel', channelTypes: [0] },
	PARENT_CHANNEL_ID: { label: 'Канал архивов', type: 'channel', channelTypes: [0] },
	ARCHIVE_SETTINGS_CHANNEL: { label: 'Канал списков архивов', type: 'channel', channelTypes: [0] },
	PLUS_CHANNEL_ID: { label: 'Канал регистрации на капт', type: 'channel', channelTypes: [0] },
	PING_CHANNEL_ID: { label: 'Канал уведомлений о группах', type: 'channel', channelTypes: [0, 5] },
	CAPT_INFO_CHANNEL_ID: { label: 'Канал объявлений каптов из Telegram', type: 'channel', channelTypes: [0] },
	ADMIN_ROLES: { label: 'Роли модераторов бота (не дают доступ в дашборд)', type: 'roles' },
	ACCESS_GROUP_ROLES: { label: 'Создание групп: расписание и /group', type: 'roles' },
	ACCESS_MOVE_ALL_ROLES: { label: 'Перемещение участников: /move-all', type: 'roles' },
	ROLE_PREFIXES: { label: 'Префиксы ролей в никах (приоритет сверху вниз)', type: 'rolePrefixes' },
	MAIN_ROLE_ID: { label: 'Роль после принятия заявки', type: 'role' },
	AUTO_ROLE: { label: 'Роль участников для архивов', type: 'role' },
	ARCHIVE_GROUP_ROLES: { label: 'Группы ролей в архивах', type: 'roles' },
	PRIORITY_ROLES: { label: 'Приоритет ролей на капт (сверху вниз)', type: 'roles' },
	DISCORD_NOTIFICATION_CHANNEL_IDS: { label: 'Каналы массовой Telegram-рассылки', type: 'channels', channelTypes: [0, 5] },
	TELEGRAM_BROADCAST_ENABLED: { label: 'Доставка массовой Telegram-рассылки', type: 'boolean', default: true },
	MAJESTIC_AUTO_NICKNAMES: { label: 'Автосинхронизация ников и рангов Majestic каждые 10 минут', type: 'boolean', default: true },
	MAJESTIC_AUTO_KICK: { label: 'Автокик из Discord по новым увольнениям из семьи Majestic', type: 'boolean', default: true },
	DASHBOARD_ALLOW_MENTIONS: { label: 'Разрешить @everyone, @here и пользователей при ручной публикации (роли разрешены всегда)', type: 'boolean', default: false }
}

function refreshBoundFields(state: DashboardState) {
	for (const key of Object.keys(catalog)) if (key.startsWith('permanent.')) delete catalog[key]
	for (const binding of Object.values(state.bindings || {})) for (const field of binding.fields || []) catalog[field.key] = field
}

function createStore(env = process.env) {
	let state: DashboardState = { templates: {}, settings: {} }
	let revision = 0
	let pool: Pool
	let ready = false
	type SettingFor<K extends string> = K extends 'ROLE_PREFIXES' ? RolePrefix[] : K extends 'TELEGRAM_BROADCAST_ENABLED' | 'MAJESTIC_AUTO_NICKNAMES' | 'MAJESTIC_AUTO_KICK' | 'DASHBOARD_ALLOW_MENTIONS' ? boolean : string
	function getSetting<K extends string>(key: K): SettingFor<K> {
		if (key === 'ROLE_PREFIXES') return structuredClone(state.settings[key] ?? defaultRolePrefixes(String(getSetting('ADMIN_ROLES')).split(',').map(id => id.trim()).filter(Boolean))) as SettingFor<K>
		const value = Object.hasOwn(state.settings, key) ? state.settings[key]
			: settingDefinitions[key]?.default ?? ''
		return (settingDefinitions[key]?.type === 'boolean' ? value === true || value === 'true' : value) as SettingFor<K>
	}
	return {
		get ready() { return ready },
		get revision() { return revision },
		get majesticAutoKickChangedAt() { return state.majesticAutoKickChangedAt ?? 0 },
		get templateVariables() { return structuredClone(state.templateVariables || {}) },
		get templateVariableLabels() { return structuredClone(state.templateVariableLabels || {}) },
		getSetting,
		get bindings() { return structuredClone(state.bindings || {}) },
		get mclLists() { return structuredClone(state.mclLists || {}) },
		get capturePresets() { return structuredClone(state.capturePresets || {}) },
		roleIds(key: string) { return String(getSetting(key)).split(',').map(id => id.trim()).filter(Boolean) },
		decorate(key: string, container: ContainerBuilder) {
			return container.clearAccentColor()
		},
		text(key: string, variables: Record<string, unknown> = {}, fallback?: string, raw = false) {
			const generated = key.includes('.document') ? layout.documents([...legacyFields().map(field => ({ ...field, value: state.templates[field.key] ?? field.value })), ...Object.entries(state.templates).filter(([key]) => !catalog[key] && /^rules\.(heading|rule)\./.test(key)).map(([key, value]) => ({ ...templateDefinition(key)!, key, value }))]).find(field => field.key === key)?.value : undefined
			let source = (/^(archives|unanswered)\./.test(key) ? undefined : state.templates[key]) ?? generated ?? catalog[key]?.default ?? fallback
			if (key === 'schedule.banner' && typeof source === 'string' && source.trim().startsWith('<img')) {
				const parsed = (require('../../public/component-markdown') as typeof import('../../public/component-markdown')).parse(source)
				source = parsed.find(item => item.type === 'image')?.value || ''
			}
			if ((key.includes('.document') || key.startsWith('permanent.')) && typeof source === 'string' && source.includes('<separator')) {
				const markdown: typeof import('../../public/component-markdown') = (require('../../public/component-markdown') as typeof import('../../public/component-markdown'))
				const visibleSeparators = /^(promotion|recruit)\.document$|^permanent\.(promotion|recruit)\./.test(key)
				source = markdown.stringify(markdown.parse(source).map(item => visibleSeparators && item.type === 'separator' ? { ...item, divider: true } : item))
			}
			if (typeof source !== 'string') throw new Error(`Unknown template: ${key}`)
			const custom = raw ? {} : state.templateVariables?.[catalog[key]?.group || templateDefinition(key)?.group || ''] || {}
			return replaceTemplateVariables(source, custom, variables)
		},
		snapshot() {
			const fields = { ...catalog }
			for (const kind of ['promotion', 'recruit']) if (!state.bindings?.[kind]) fields[kind + '.document'] = templateDefinition(kind + '.document')!
			for (const key of Object.keys(state.templates)) if (templateDefinition(key)) fields[key] = templateDefinition(key)!
			return { revision, templateVariables: this.templateVariables, templateVariableLabels: this.templateVariableLabels, bindings: this.bindings, templates: Object.entries(fields).sort(([a], [b]) => {
				if (a.startsWith('rules.') !== b.startsWith('rules.')) return a.startsWith('rules.') ? -1 : 1
				if (a === 'rules.1' || b === 'rules.1') return a === b ? 0 : a === 'rules.1' ? -1 : 1
				const order = (key: string) => { const parts = key.split('.'); return [Number(parts[2]), parts[1] === 'heading' ? 0 : Number(parts[3])] }
				if (!/^rules\.(heading|rule)\./.test(a) || !/^rules\.(heading|rule)\./.test(b)) return 0
				const x = order(a), y = order(b)
				return x[0] - y[0] || x[1] - y[1]
			}).filter(([key]) => !hiddenTemplate(key)).map(([key, value]) => ({
				key, ...value, ...(value.type === 'text' ? { components: value.components ?? !(/^navigation\.item\./.test(key) || /^panel\.row\./.test(key) || key === 'invite.3') } : {}), value: this.text(key, {}, value.default, true)
			})), settings: Object.entries(settingDefinitions).map(([key, value]) => ({ key, ...value, value: getSetting(key) })) }
		},
		async init(database: Pool) {
			pool = database
			await pool.query(`CREATE TABLE IF NOT EXISTS dashboard_navigation_messages (
				message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
				container_index INTEGER NOT NULL, prefix_length INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS mcl_messages (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY (guild_id, channel_id));
			CREATE TABLE IF NOT EXISTS mcl_commands (guild_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (guild_id, name));
			CREATE TABLE IF NOT EXISTS capture_preset_commands (guild_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (guild_id, name));
			CREATE TABLE IF NOT EXISTS dashboard_state (
				id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0,
				value JSONB NOT NULL DEFAULT '{"templates":{},"settings":{}}'
			);
			CREATE TABLE IF NOT EXISTS dashboard_audit (
				id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details JSONB NOT NULL
			);
			INSERT INTO dashboard_state (id) VALUES (1) ON CONFLICT DO NOTHING`)
			const db = await pool.connect()
			try {
				await db.query('BEGIN')
				const result = await db.query('SELECT revision, value FROM dashboard_state WHERE id = 1 FOR UPDATE')
				state = result.rows[0].value
				revision = result.rows[0].revision
				if (!state.settingsEnvMigrated) {
					const imported: string[] = []
					for (const [key, field] of Object.entries(settingDefinitions)) {
						const value = env[key]?.trim()
						if (Object.hasOwn(state.settings, key) || !value || field.type === 'rolePrefixes') continue
						state.settings[key] = field.type === 'boolean' ? value === 'true' : value
						imported.push(key)
					}
					state.settingsEnvMigrated = true
					await db.query('UPDATE dashboard_state SET value = $1::jsonb, revision = revision + 1 WHERE id = 1', [JSON.stringify(state)])
					await db.query('INSERT INTO dashboard_audit (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)',
						['env-migration', 'settings.migrate', imported.join(', '), JSON.stringify({ imported })])
					revision++
				}
				await db.query('COMMIT')
			} catch (error) {
				await db.query('ROLLBACK')
				throw error
			} finally { db.release() }
			refreshBoundFields(state)
			ready = true
		},
		async trackNavigation(message: Message, location: { containerIndex: number; prefixLength: number }) {
			await pool.query(`INSERT INTO dashboard_navigation_messages (message_id, guild_id, channel_id, container_index, prefix_length)
				VALUES ($1, $2, $3, $4, $5) ON CONFLICT (message_id) DO UPDATE SET container_index = EXCLUDED.container_index, prefix_length = EXCLUDED.prefix_length`,
				[message.id, message.guildId || message.guild!.id, message.channelId, location.containerIndex, location.prefixLength])
		},
		async navigationMessages(guildId: string) {
			return (await pool.query<{ message_id: string; guild_id: string; channel_id: string; container_index: number; prefix_length: number }>('SELECT * FROM dashboard_navigation_messages WHERE guild_id = $1', [guildId])).rows
		},
		async forgetNavigation(messageId: string) {
			await pool.query('DELETE FROM dashboard_navigation_messages WHERE message_id = $1', [messageId])
		},
		async save(section: keyof DashboardState, values: Record<string, string | boolean | RolePrefix[] | Binding | MclList | CapturePreset | Record<string, string> | null>, expectedRevision: number, actor?: Actor | string, variableLabels?: Record<string, Record<string, string>>) {
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
				if (section === 'templateVariables' && variableLabels) next.templateVariableLabels = { ...current.value.templateVariableLabels, ...variableLabels }
				if (section === 'bindings') {
					next.templates = { ...current.value.templates }
					for (const [kind, binding] of Object.entries(values)) {
						if (binding && ['promotion', 'recruit'].includes(kind)) delete next.templates[kind + '.document']
						for (const field of [...(current.value.bindings?.[kind]?.fields || []), ...((typeof binding === 'object' && binding && 'fields' in binding ? binding.fields : []) || [])]) delete next.templates[field.key]
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
				const changes: Record<string, unknown> = {}
				for (const key of Object.keys(values)) {
					const definition = section === 'templates' ? templateDefinition(key) : settingDefinitions[key]
					const fallback = section === 'settings' ? definition?.default ?? '' : definition?.default
					const before = current.value[section]?.[key] ?? fallback
					const after = next[section]?.[key] ?? fallback
					if (JSON.stringify(before) !== JSON.stringify(after)) changes[key] = section === 'bindings'
						? { label: ({ rules: 'Привязка правил', invite: 'Привязка приглашения', promotion: 'Привязка системы повышения', recruit: 'Привязка памятки рекрута' } as Record<string, string>)[key] || key, before: before?.link || null, after: after?.link || null }
						: { label: definition?.label || key, before, after }
				}
				if (section === 'templateVariables' && variableLabels) for (const [group, labels] of Object.entries(variableLabels)) {
					const before = current.value.templateVariableLabels?.[group] || {}
					if (JSON.stringify(before) !== JSON.stringify(labels)) changes[group + '.labels'] = { label: 'Названия переменных · ' + group, before, after: labels }
				}
				if (section === 'settings' && changes.MAJESTIC_AUTO_KICK) {
					next.majesticAutoKickChangedAt = Math.max(Date.now(), (current.value.majesticAutoKickChangedAt || 0) + 1)
				}
				await db.query('UPDATE dashboard_state SET value = $1::jsonb, revision = revision + 1 WHERE id = 1', [JSON.stringify(next)])
				await db.query('INSERT INTO dashboard_audit (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)',
					[typeof actor === 'string' ? actor : actor?.id, section, Object.keys(values).join(', '), JSON.stringify({ actorName: (typeof actor === 'object' ? actor?.name : undefined), fields: changes })])
				await db.query('COMMIT')
				state = next
				refreshBoundFields(state)
				revision = current.revision + 1
				return revision
			} catch (caughtError) {
 const error = getError(caughtError)

				await db.query('ROLLBACK')
				throw error
			} finally { db.release() }
		},
		async audit(actor: Actor | string | undefined, action: string, target: string, details: Record<string, unknown> = {}) {
			await pool.query('INSERT INTO dashboard_audit (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)',
				[typeof actor === 'string' ? actor : actor?.id, action, target, JSON.stringify({ ...details, actorName: (typeof actor === 'object' ? actor?.name : undefined) || details.actorName })])
		},
		async history() {
			return (await pool.query('SELECT id, created_at, actor, action, target, details FROM dashboard_audit ORDER BY id DESC LIMIT 100')).rows
		}
	}
}

const store = createStore()
export { store, createStore, catalog, settingDefinitions, templateDefinition }
