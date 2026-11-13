import { replaceTemplateVariables, templateVariableName } from '../../shared/templateVariables'
import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { randomUUID } from 'node:crypto'
import { PermissionsBitField } from 'discord.js'
import { createAuth, problem } from './auth'
import { store, catalog, settingDefinitions, templateDefinition } from './store'
import { parseMessageLink } from '../services/containerMessageService'
import { isHttpsUrl } from './messageEditor'
import permanent = require('./permanentMessages')
import navigation = require('./navigationMessages')
import { createMajesticSync } from '../services/majesticSync'
import { syncRolePrefixes } from '../services/rolePrefixSync'
import { getSchedule } from '../services/eventSchedule'

function validateTemplates(values: Record<string, string | null>, custom = store.templateVariables) {
	if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw problem(400, 'Выберите шаблон.')
	for (const [key, value] of Object.entries(values)) {
		const field = templateDefinition(key)
		if (!field) throw problem(400, 'Неизвестный шаблон.')
		if (value === null) continue
		if (field.type === 'color') {
			if (typeof value !== 'string' || (value && !/^#[a-f0-9]{6}$/i.test(value))) throw problem(400, 'Цвет должен иметь вид #5865f2 или быть пустым.')
			continue
		}
		if (value === '' && ['rules.1', 'invite.1', 'invite.2', 'announcement.banner', 'schedule.banner'].includes(key)) continue
		if (typeof value !== 'string' || !value.trim() || value.length > (field.maxLength ?? 4000)) throw problem(400, `Проверьте длину поля «${field.label}».`)
		if (field.type === 'url' && value !== field.default && !isHttpsUrl(value)) throw problem(400, 'Нужна HTTPS-ссылка.')
		if (field.type === 'text') {
			try {
				const expanded = replaceTemplateVariables(value, custom[field.group] || {})
				if (expanded.length > (field.maxLength ?? 4000)) throw new Error('Текст с переменными превышает допустимую длину.')
				const items = (require('../../public/component-markdown') as typeof import('../../public/component-markdown')).parse(expanded)
				const components = field.components ?? !(/^navigation\.item\./.test(key) || /^panel\.row\./.test(key) || key === 'invite.3')
				if (!components && items.some(item => item.type !== 'text')) throw new Error('В этом поле доступно только форматирование текста; структуру задаёт сообщение.')
				if (components && items.some(item => item.type !== 'text')) (require('../services/containerMessageService') as typeof import('../services/containerMessageService')).buildEditPayload({ items })
			}
			catch (caughtError) {
 const error = getError(caughtError)
 throw problem(400, `Поле «${field.label}»: ${error.message}`) }
		}
		const variables = [...value.matchAll(/\{([a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ0-9_-]*)\}/g)].map(match => match[1])
		if (!key.startsWith('permanent.') && (variables.some((name: string) => !(field.variables || []).includes(name) && !Object.hasOwn(custom[field.group] || {}, name)) || (field.variables || []).some((name: string) => !variables.includes(name)))) throw problem(400, 'Сохраните все переменные шаблона без изменения их названий.')
	}
	const fields = new Map(store.snapshot().templates.map(field => [field.key, field]))
	for (const [key, value] of Object.entries(values)) {
		if (value === null && !Object.hasOwn(catalog, key)) fields.delete(key)
		else fields.set(key, { ...templateDefinition(key)!, key, value: value ?? catalog[key].default ?? '' })
	}
	const rules = [...fields.values()].filter(field => /^rules\.(heading|rule)\./.test(field.key))
	if (rules.length > 18) throw problem(400, 'В одном сообщении правил можно разместить не более 18 заголовков и пунктов суммарно.')
	for (const field of rules) {
		const match = /^rules\.rule\.(\d+)\./.exec(field.key)
		if (match && !fields.has('rules.heading.' + match[1])) throw problem(400, 'Сначала добавьте раздел для нового правила.')
	}
	for (const group of ['Правила', 'Приглашение', 'Навигация']) {
		const length = [...fields.values()].filter(field => field.group === group && field.type === 'text' && (!['Приглашение', 'Навигация'].includes(group) || field.key === (group === 'Приглашение' ? 'invite.document' : 'navigation.document') || ['invite.3', 'invite.4'].includes(field.key)) && (group !== 'Правила' || (Object.keys(values).some(key => /^rules\.(heading|rule)\./.test(key)) ? /^rules\.(heading|rule)\./.test(field.key) : !fields.has('rules.document') || field.key === 'rules.document')))
			.reduce((sum, field) => sum + field.value.length, 0)
		const limit = group === 'Приглашение' ? 2700 : 3800
		if (length > limit) throw problem(400, `Слишком много текста в разделе «${group}». Оставьте не более ${limit} символов.`)
	}
}

async function validateSettings(values: Record<string, unknown>, guild: D.Guild) {
	if (!values || typeof values !== 'object' || Array.isArray(values)) throw problem(400, 'Некорректные настройки.')
	for (const [key, value] of Object.entries(values)) {
		const field = Object.hasOwn(settingDefinitions, key) ? settingDefinitions[key] : null
		if (!field) throw problem(400, 'Неизвестная настройка.')
		if (value === null) continue
		if (field.type === 'boolean') {
			if (typeof value !== 'boolean') throw problem(400, 'Ожидается переключатель.')
		} else if (field.type === 'rolePrefixes') {
			if (!Array.isArray(value) || value.length > 100) throw problem(400, 'Ожидается список префиксов (не более 100).')
			const seen = new Set()
			for (const entry of value) {
				if (!entry || typeof entry.roleId !== 'string' || !/^\d{17,20}$/.test(entry.roleId) || !guild.roles.cache.has(entry.roleId) || entry.roleId === guild.id) throw problem(400, 'Выберите роль этого сервера для префикса.')
				if (seen.has(entry.roleId)) throw problem(400, 'Для каждой роли можно задать только один префикс.')
				if (typeof entry.prefix !== 'string' || entry.prefix.length > 24 || !entry.prefix.trim() || /[\r\n|]/.test(entry.prefix)) throw problem(400, 'Префикс должен содержать 1–24 символа без переноса строки и |, например TAG >.')
				seen.add(entry.roleId)
			}
		} else if (field.type === 'color') {
			if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) throw problem(400, 'Некорректный цвет.')
		} else {
			if (typeof value !== 'string' || value.length > 2000) throw problem(400, 'Некорректный список каналов или ролей.')
			const ids = value.split(',').map(id => id.trim()).filter(Boolean)
			if (!['roles', 'channels'].includes(field.type) && ids.length > 1) throw problem(400, 'Выберите одно значение.')
			for (const id of ids) {
				if (!/^\d{17,20}$/.test(id)) throw problem(400, 'Некорректный Discord ID.')
				const item = field.type.startsWith('role') ? guild.roles.cache.get(id) : await guild.channels.fetch(id)
				if (!item || item.guild.id !== guild.id || (field.channelTypes && (!('type' in item) || !field.channelTypes.includes(item.type)))) throw problem(400, `Недопустимый канал или роль: ${id}.`)
				if (key === 'DISCORD_NOTIFICATION_CHANNEL_IDS' && id === process.env.DISCORD_NOTIFICATION_CHANNEL_ID) throw problem(400, 'Канал личных уведомлений нельзя включить в массовую рассылку.')
			}
		}
	}
}

function registerDashboard(app: E.Express, client: D.Client, pool: Pg.Pool, { auth = createAuth({ client, pool }), majestic }: { auth?: ReturnType<typeof createAuth>; majestic?: ReturnType<typeof createMajesticSync> } = {}) {
	auth.register(app)
	app.use('/api', auth.middleware)
	app.use('/api', async (req: E.Request, res: E.Response, next: E.NextFunction) => {
		try {
			if (!store.ready) throw problem(503, 'База настроек недоступна. Проверьте подключение PostgreSQL и перезапустите бот.')
			const link = req.query.link ?? req.body?.link
			if (link && parseMessageLink(link).guildId !== req.guild.id) throw problem(403, 'Доступ разрешён только к настроенному серверу.')
			const channelId = req.body?.channelId ?? (req.path === '/channel-info' ? req.query.id : null)
			if (channelId) {
				if (typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) throw problem(400, 'Некорректный ID канала.')
				const channel = await client.channels.fetch(channelId)
				if (!channel || !('guildId' in channel) || channel.guildId !== req.guild.id) throw problem(403, 'Канал находится на другом сервере.')
			}
			next()
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.get('/api/session', (req: E.Request, res: E.Response) => res.json({ user: { ...req.dashboardUser, avatar: req.guild.members.cache.get(req.dashboardUser!.id)?.user.displayAvatarURL({ size: 64 }) }, csrf: req.csrf, guild: { id: req.guild.id, name: req.guild.name } }))
	app.get('/api/schedule', (req: E.Request, res: E.Response) => res.set('Cache-Control', 'no-store').json(getSchedule()))
	const sync = client.majesticSync = majestic || client.majesticSync || createMajesticSync({ pool, store })
	app.get('/api/majestic', async (req: E.Request, res: E.Response) => {
		try { res.json(await sync.state(req.guild)) } catch { res.status(503).json({ error: 'Не удалось загрузить состояние Majestic из базы.' }) }
	})
	for (const operation of ['preview', 'resolve', 'apply', 'stop'] as const) app.post('/api/majestic/' + operation, async (req: E.Request, res: E.Response) => {
		try { res.json(await sync[operation](req.guild, req.dashboardUser, req.body)) }
		catch (caughtError) {
 const error = getError(caughtError)
 res.status(error.status || 503).json({ error: error.status ? error.message : 'Операция Majestic недоступна. Проверьте базу и подключение Discord.' }) }
	})
	app.post('/api/logout', auth.logout)
	app.get('/api/overview', async (req: E.Request, res: E.Response) => {
		try {
			await pool.query('SELECT 1')
			res.json({ ready: client.isReady(), ping: client.ws.ping, uptime: Math.floor((client.uptime || 0) / 1000), database: true, history: (await store.history()).slice(0, 5) })
		} catch { res.status(503).json({ error: 'Нет подключения к PostgreSQL.' }) }
	})
	app.get('/api/resources', async (req: E.Request, res: E.Response) => {
		try {
			await req.guild.roles.fetch()
			const channels = await req.guild.channels.fetch()
			res.json({ channels: [...channels.values()].filter((channel): channel is NonNullable<typeof channel> => Boolean(channel)).map(channel => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId,
				canSend: Boolean(channel.permissionsFor(client.user!)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) })),
			roles: [...req.guild.roles.cache.values()].filter(role => role.id !== req.guild.id).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name })) })
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.get('/api/channel-threads/:id', async (req: E.Request, res: E.Response) => {
		try {
			const channel = await req.guild.channels.fetch(String(req.params.id))
			if (!channel || !('threads' in channel)) throw problem(400, 'Выберите канал с ветками.')
			const active = await req.guild.channels.fetchActiveThreads()
			const threads = new Map(active.threads)
			for (const type of (channel.type === 0 ? ['public', 'private'] as const : ['public'] as const)) {
				let before: Date | undefined
				while (true) {
					let archived
					try { archived = await channel.threads.fetchArchived({ type, fetchAll: false, limit: 100, before }) }
					catch (caught) { const error = getError(caught); if (error.code === 50013 || error.code === 50001) break; throw error }
					for (const thread of archived.threads.values()) threads.set(thread.id, thread)
					const timestamp = archived.threads.last()?.archiveTimestamp
					if (!archived.hasMore || !timestamp || before && timestamp >= before.getTime()) break
					before = new Date(timestamp)
				}
			}

			res.json([...threads.values()].filter(thread => thread.parentId === channel.id && !thread.locked && thread.permissionsFor(client.user!)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessagesInThreads])).map(thread => ({ id: thread.id, name: thread.name, type: thread.type, parentId: channel.id, canSend: true })))
		} catch (caught) { respondError(res, getError(caught)) }
	})
	client.mclLists ||= (require('../services/mclLists') as typeof import('../services/mclLists')).createMclLists({ client, pool, store })
	client.capturePresets ||= (require('../features/capture/capturePresets') as typeof import('../features/capture/capturePresets')).createCapturePresets({ client, pool, store })
	app.get('/api/capture-presets', (req: E.Request, res: E.Response) => res.json({ presets: Object.values(store.capturePresets), revision: store.revision }))
	app.post('/api/capture-presets', async (req: E.Request, res: E.Response) => {
		try { res.json(await client.capturePresets!.save(req.guild, req.body.presets, req.body.revision, req.dashboardUser)) }
		catch (caught) { respondError(res, getError(caught)) }
	})
	app.get('/api/mcl-lists', (req: E.Request, res: E.Response) => res.json({ lists: Object.values(store.mclLists), revision: store.revision }))
	app.post('/api/mcl-lists', async (req: E.Request, res: E.Response) => {
		try {
			if (!Number.isSafeInteger(req.body.revision)) throw problem(400, 'Обновите страницу перед сохранением.')
			res.json(await client.mclLists!.save(req.guild, req.body.lists, req.body.revision, req.dashboardUser))
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.get('/api/config', async (req: E.Request, res: E.Response) => {
		try {
			await permanent.upgradeLegacyBindings(client, req.guild)
			res.json(store.snapshot())
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	for (const section of ['templates', 'settings'] as const) app.post('/api/' + section, async (req: E.Request, res: E.Response) => {
		try {
			const { values, revision } = req.body
			if (!Number.isSafeInteger(revision)) throw problem(400, 'Обновите страницу перед сохранением.')
			if (section === 'templates') validateTemplates(values)
			else await validateSettings(values, req.guild)
			await store.save(section, values, revision, req.dashboardUser)
			const syncResults: T.SyncResult[] = section === 'templates' ? await permanent.syncMessages(Object.keys(values), client, req.guild, undefined, req.dashboardUser) : []
			if (section === 'templates' && Object.keys(values).some((key: string) => key.startsWith('navigation.'))) syncResults.push(...await navigation.sync(client, req.guild))
			if (syncResults.length) await store.audit(req.dashboardUser, 'message.sync', Object.keys(values).join(', '), { syncResults })
				.catch(error => console.error('[Dashboard audit]', error.message))
			res.json({ ...store.snapshot(), syncResults })
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	const prefixSyncs = new Set()
	app.post('/api/role-prefixes/sync', async (req: E.Request, res: E.Response) => {
		if (prefixSyncs.has(req.guild.id)) return respondError(res, problem(409, 'Префиксы уже обновляются.'))
		prefixSyncs.add(req.guild.id)
		try {
			const rolePrefixes = structuredClone(store.getSetting('ROLE_PREFIXES'))
			await store.audit(req.dashboardUser, 'role-prefixes.sync.request', req.guild.id)
			const result = await syncRolePrefixes(req.guild, rolePrefixes)
			await store.audit(req.dashboardUser, 'role-prefixes.sync', req.guild.id, result)
				.catch(error => console.error('[Dashboard audit]', error.message))
			res.json(result)
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
		finally { prefixSyncs.delete(req.guild.id) }
	})
	app.post('/api/template-variables', async (req: E.Request, res: E.Response) => {
		try {
			const { group, values, labels, revision } = req.body
			const fields = store.snapshot().templates.filter(field => field.group === group)
			if (!fields.length || !Number.isSafeInteger(revision) || !values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 50) throw problem(400, 'Проверьте шаблон и список переменных (до 50).')
			const reserved = new Set(fields.flatMap(field => field.variables || []))
			for (const [name, value] of Object.entries(values)) {
				if (!templateVariableName.test(name)) throw problem(400, `Ключ «${name}»: начните с буквы, используйте до 64 букв, цифр, дефисов или подчёркиваний без пробелов.`)
				if (reserved.has(name)) throw problem(400, `Ключ «${name}» занят системной переменной.`)
				if (typeof value !== 'string' || value.length > 4000 || /\{[^{}]+\}/.test(value)) throw problem(400, `Значение «${name}»: до 4000 символов без вложенных переменных.`)
			}
			if (labels !== undefined && (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.entries(labels).some(([name, label]) => !Object.hasOwn(values, name) || typeof label !== 'string' || !label.trim() || label.length > 100))) throw problem(400, 'Название переменной: от 1 до 100 символов. Для каждого названия нужен существующий ключ.')
			validateTemplates(Object.fromEntries(fields.map(field => [field.key, field.value])), { ...store.templateVariables, [group]: values })
			await store.save('templateVariables', { [group]: values }, revision, req.dashboardUser, labels === undefined ? undefined : { [group]: labels })
			const keys = fields.map(field => field.key)
			const syncResults: T.SyncResult[] = await permanent.syncMessages(keys, client, req.guild, undefined, req.dashboardUser)
			if (keys.some(key => key.startsWith('navigation.'))) syncResults.push(...await navigation.sync(client, req.guild))
			if (syncResults.length) await store.audit(req.dashboardUser, 'message.sync', group, { syncResults }).catch(error => console.error('[Dashboard audit]', error.message))
			res.json({ ...store.snapshot(), syncResults })
		} catch (caught) { respondError(res, getError(caught)) }
	})
	app.post('/api/templates/create', async (req: E.Request, res: E.Response) => {
		try {
			const { name, revision } = req.body
			if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || !Number.isSafeInteger(revision)) throw problem(400, 'Укажите название шаблона (до 80 символов) и обновите данные.')
			if (store.snapshot().templates.some(field => field.group === name.trim())) throw problem(400, 'Раздел с таким названием уже существует.')
			const kind = 'custom-' + randomUUID()
			await store.save('bindings', { [kind]: { link: '', markdown: true, fields: [{ key: 'permanent.' + kind + '.document', path: 'markdown', group: name.trim(), label: 'Текст сообщения', type: 'text', components: true, maxLength: 16000, default: '# Новое сообщение', variables: [] }] } }, revision, req.dashboardUser)
			res.json(store.snapshot())
		} catch (caught) { respondError(res, getError(caught)) }
	})
	app.post('/api/templates/delete', async (req: E.Request, res: E.Response) => {
		try {
			const { kind, revision } = req.body
			if (typeof kind !== 'string' || !/^custom-[a-f0-9-]{36}$/.test(kind) || !store.bindings[kind] || !Number.isSafeInteger(revision)) throw problem(400, 'Выберите пользовательский шаблон и обновите данные.')
			await store.save('bindings', { [kind]: null }, revision, req.dashboardUser)
			res.json(store.snapshot())
		} catch (caught) { respondError(res, getError(caught)) }
	})
	app.post('/api/permanent-message/publish', async (req: E.Request, res: E.Response) => {
		try {
			const { kind, channelId, revision } = req.body
			if (!channelId || !Number.isSafeInteger(revision)) throw problem(400, 'Выберите канал и обновите данные.')
			await permanent.publish(kind, channelId, revision, client, req.guild, req.dashboardUser)
			res.json(store.snapshot())
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.post('/api/navigation/sync', async (req: E.Request, res: E.Response) => {
		try {
			const syncResults = await navigation.sync(client, req.guild)
			await store.audit(req.dashboardUser, 'message.sync', 'navigation', { syncResults })
			res.json({ ...store.snapshot(), syncResults })
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.post('/api/permanent-message', async (req: E.Request, res: E.Response) => {
		try {
			const { kind, link, revision } = req.body
			if (!permanent.definition(kind) || !Number.isSafeInteger(revision)) throw problem(400, 'Проверьте вид сообщения и обновите данные.')
			const previous = store.bindings[kind]
			const binding = link ? permanent.bindingFor(kind, await fetchOwnedMessage(link, req.guild)) : kind.startsWith('custom-') && previous ? { ...previous, link: '', fields: previous.fields.map(field => ({ ...field, default: store.text(field.key) })) } : null
			if (binding?.link) await permanent.fetchMessage(client, req.guild, link)
			const id = binding?.link && parseMessageLink(link).messageId
			if (id && Object.entries(store.bindings).some(([other, value]) => other !== kind && value.link && parseMessageLink(value.link).messageId === id)) throw problem(400, 'Сообщение уже привязано к другому разделу.')
			await store.save('bindings', { [kind]: binding }, revision, req.dashboardUser)
			res.json(store.snapshot())
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.post('/api/permanent-message/sync', async (req: E.Request, res: E.Response) => {
		try {
			if (!permanent.definition(req.body.kind) || !store.bindings[req.body.kind]?.link) throw problem(400, 'Сначала привяжите сообщение.')
			await store.audit(req.dashboardUser, 'message.sync.request', req.body.kind)
			const syncResults = await permanent.syncMessages([], client, req.guild, req.body.kind, req.dashboardUser)
			await store.audit(req.dashboardUser, 'message.sync', req.body.kind, { syncResults })
				.catch(error => console.error('[Dashboard] Не удалось записать результат обновления:', error.message))
			res.json({ ...store.snapshot(), syncResults })
		} catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	app.get('/api/history', async (req: E.Request, res: E.Response) => {
		try { res.json(await store.history()) } catch (caughtError) {
 const error = getError(caughtError)
 respondError(res, error) }
	})
	async function fetchOwnedMessage(link: string, guild: D.Guild) {
		const ids = parseMessageLink(link)
		if (ids.guildId !== guild.id) throw problem(403, 'Сообщение другого сервера.')
		const channel = await guild.channels.fetch(ids.channelId)
		if (!channel || !channel.isTextBased()) throw problem(400, 'Нужен текстовый канал.')
		const message = await channel.messages.fetch({ message: ids.messageId, force: true, cache: false })
		if (message.author.id !== client.user!.id || message.webhookId) throw problem(403, 'Редактировать можно только сообщения этого бота.')
		const dynamic = await pool.query('SELECT 1 FROM active_captures WHERE message_id = $1 LIMIT 1', [message.id])
		const war = await pool.query('SELECT 1 FROM family_wars WHERE announcement_id = $1 OR registration_id = $1 LIMIT 1', [message.id])
		if (channel.id === store.getSetting('ARCHIVE_SETTINGS_CHANNEL')) throw problem(409, 'Списки архивов обновляет бот. Их оформление недоступно для изменения.')
		if (dynamic.rows.length || war.rows.length) throw problem(409, 'Этот список обновляет бот. Измените регистрацию во вкладке «Шаблоны».')
		return message
	}
}

function respondError(res: E.Response, error: ReturnType<typeof getError>) {
	res.status(error.status || 502).json({ error: error.status ? error.message : 'Не удалось выполнить запрос. Проверьте доступ бота к каналу и базе данных.' })
}

export { registerDashboard, validateTemplates, validateSettings }
