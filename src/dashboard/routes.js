const { PermissionsBitField } = require('discord.js')
const { createAuth, problem } = require('./auth')
const { store, catalog, settingDefinitions, templateDefinition } = require('./store')
const { parseMessageLink } = require('../services/containerMessageService')
const { isHttpsUrl } = require('./messageEditor')
const permanent = require('./permanentMessages')
const navigation = require('./navigationMessages')
const { createMajesticSync } = require('../services/majesticSync')
const { syncRolePrefixes } = require('../services/rolePrefixSync')

function validateTemplates(values) {
	if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw problem(400, 'Выберите шаблон.')
	for (const [key, value] of Object.entries(values)) {
		const field = templateDefinition(key)
		if (!field) throw problem(400, 'Неизвестный шаблон.')
		if (value === null) continue
		if (field.type === 'color') {
			if (typeof value !== 'string' || (value && !/^#[a-f0-9]{6}$/i.test(value))) throw problem(400, 'Цвет должен иметь вид #5865f2 или быть пустым.')
			continue
		}
		if (typeof value !== 'string' || !value.trim() || value.length > field.maxLength) throw problem(400, `Проверьте длину поля «${field.label}».`)
		if (field.type === 'url' && value !== field.default && !isHttpsUrl(value)) throw problem(400, 'Нужна HTTPS-ссылка.')
		if (field.type === 'text') {
			try {
				const items = require('../../public/component-markdown').parse(value)
				const components = field.components ?? !(/^navigation\.item\./.test(key) || /^panel\.row\./.test(key) || key === 'invite.3')
				if (!components && items.some(item => item.type !== 'text')) throw new Error('В этом поле доступно только форматирование текста; структуру задаёт сообщение.')
				if (components && items.some(item => item.type !== 'text')) require('../services/containerMessageService').buildEditPayload({ items })
			}
			catch (error) { throw problem(400, `Поле «${field.label}»: ${error.message}`) }
		}
		const variables = [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1])
		if (!key.startsWith('permanent.') && (variables.some(name => !field.variables.includes(name)) || field.variables.some(name => !variables.includes(name)))) throw problem(400, 'Сохраните все переменные шаблона без изменения их названий.')
	}
	const fields = new Map(store.snapshot().templates.map(field => [field.key, field]))
	for (const [key, value] of Object.entries(values)) {
		if (value === null && !Object.hasOwn(catalog, key)) fields.delete(key)
		else fields.set(key, { ...templateDefinition(key), key, value: value ?? catalog[key].default })
	}
	const rules = [...fields.values()].filter(field => /^rules\.(heading|rule)\./.test(field.key))
	if (rules.length > 18) throw problem(400, 'В одном сообщении правил можно разместить не более 18 заголовков и пунктов суммарно.')
	for (const field of rules) {
		const match = /^rules\.rule\.(\d+)\./.exec(field.key)
		if (match && !fields.has('rules.heading.' + match[1])) throw problem(400, 'Сначала добавьте раздел для нового правила.')
	}
	for (const group of ['Правила', 'Приглашение', 'Навигация']) {
		const length = [...fields.values()].filter(field => field.group === group && field.type === 'text' && (!['Приглашение', 'Навигация'].includes(group) || field.key === (group === 'Приглашение' ? 'invite.document' : 'navigation.document') || ['invite.3', 'invite.4'].includes(field.key)) && (group !== 'Правила' || !fields.has('rules.document') || field.key === 'rules.document'))
			.reduce((sum, field) => sum + field.value.length, 0)
		const limit = group === 'Приглашение' ? 2700 : 3800
		if (length > limit) throw problem(400, `Слишком много текста в разделе «${group}». Оставьте не более ${limit} символов.`)
	}
}

async function validateSettings(values, guild) {
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
				if (typeof entry.prefix !== 'string' || entry.prefix.length > 24 || !/^\[[^\[\]\r\n|]+\]$/.test(entry.prefix.trim())) throw problem(400, 'Префикс должен быть в квадратных скобках, например [Dep], и не длиннее 24 символов.')
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
				if (!item || item.guild.id !== guild.id || (field.channelTypes && !field.channelTypes.includes(item.type))) throw problem(400, `Недопустимый канал или роль: ${id}.`)
				if (key === 'DISCORD_NOTIFICATION_CHANNEL_IDS' && id === process.env.DISCORD_NOTIFICATION_CHANNEL_ID) throw problem(400, 'Канал личных уведомлений нельзя включить в массовую рассылку.')
			}
		}
	}
}

function registerDashboard(app, client, pool, { auth = createAuth({ client, pool }), majestic } = {}) {
	app.get('/template-images/:name', (req, res) => {
		if (!['invites.png', 'revento.png', 'rules.png', 'capt.png'].includes(req.params.name)) return res.sendStatus(404)
		res.sendFile(require('path').join(__dirname, '../images', req.params.name))
	})
	auth.register(app)
	app.use('/api', auth.middleware)
	app.use('/api', async (req, res, next) => {
		try {
			if (!store.ready) throw problem(503, 'База настроек недоступна. Проверьте подключение PostgreSQL и перезапустите бот.')
			const link = req.query.link ?? req.body?.link
			if (link && parseMessageLink(link).guildId !== req.guild.id) throw problem(403, 'Доступ разрешён только к настроенному серверу.')
			const channelId = req.body?.channelId ?? (req.path === '/channel-info' ? req.query.id : null)
			if (channelId) {
				if (typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) throw problem(400, 'Некорректный ID канала.')
				const channel = await client.channels.fetch(channelId)
				if (channel?.guildId !== req.guild.id) throw problem(403, 'Канал находится на другом сервере.')
			}
			next()
		} catch (error) { respondError(res, error) }
	})
	app.get('/api/session', (req, res) => res.json({ user: req.dashboardUser, csrf: req.csrf, guild: { id: req.guild.id, name: req.guild.name } }))
	const sync = client.majesticSync = majestic || client.majesticSync || createMajesticSync({ pool, store })
	app.get('/api/majestic', async (req, res) => {
		try { res.json(await sync.state(req.guild)) } catch { res.status(503).json({ error: 'Не удалось загрузить состояние Majestic из базы.' }) }
	})
	for (const operation of ['preview', 'resolve', 'apply', 'stop']) app.post('/api/majestic/' + operation, async (req, res) => {
		try { res.json(await sync[operation](req.guild, req.dashboardUser, req.body)) }
		catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : 'Операция Majestic недоступна. Проверьте базу и подключение Discord.' }) }
	})
	app.post('/api/logout', auth.logout)
	app.get('/api/overview', async (req, res) => {
		try {
			await pool.query('SELECT 1')
			res.json({ ready: client.isReady(), ping: client.ws.ping, uptime: Math.floor(client.uptime / 1000), database: true, history: (await store.history()).slice(0, 5) })
		} catch { res.status(503).json({ error: 'Нет подключения к PostgreSQL.' }) }
	})
	app.get('/api/resources', async (req, res) => {
		try {
			await req.guild.roles.fetch()
			const channels = await req.guild.channels.fetch()
			res.json({ channels: [...channels.values()].filter(Boolean).map(channel => ({ id: channel.id, name: channel.name, type: channel.type,
				canSend: Boolean(channel.permissionsFor(client.user)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) })),
			roles: [...req.guild.roles.cache.values()].filter(role => role.id !== req.guild.id).sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name })) })
		} catch (error) { respondError(res, error) }
	})
	app.get('/api/config', async (req, res) => {
		try {
			await permanent.upgradeLegacyBindings(client, req.guild)
			res.json(store.snapshot())
		} catch (error) { respondError(res, error) }
	})
	for (const section of ['templates', 'settings']) app.post('/api/' + section, async (req, res) => {
		try {
			const { values, revision } = req.body
			if (!Number.isSafeInteger(revision)) throw problem(400, 'Обновите страницу перед сохранением.')
			if (section === 'templates') validateTemplates(values)
			else await validateSettings(values, req.guild)
			await store.save(section, values, revision, req.dashboardUser)
			const syncResults = section === 'templates' ? await permanent.syncMessages(Object.keys(values), client, req.guild, undefined, req.dashboardUser) : []
			if (section === 'templates' && Object.keys(values).some(key => key.startsWith('navigation.'))) syncResults.push(...await navigation.sync(client, req.guild))
			if (syncResults.length) await store.audit(req.dashboardUser, 'message.sync', Object.keys(values).join(', '), { syncResults })
				.catch(error => console.error('[Dashboard audit]', error.message))
			res.json({ ...store.snapshot(), syncResults })
		} catch (error) { respondError(res, error) }
	})
	const prefixSyncs = new Set()
	app.post('/api/role-prefixes/sync', async (req, res) => {
		if (prefixSyncs.has(req.guild.id)) return respondError(res, problem(409, 'Префиксы уже обновляются.'))
		prefixSyncs.add(req.guild.id)
		try {
			const rolePrefixes = structuredClone(store.getSetting('ROLE_PREFIXES'))
			await store.audit(req.dashboardUser, 'role-prefixes.sync.request', req.guild.id)
			const result = await syncRolePrefixes(req.guild, rolePrefixes)
			await store.audit(req.dashboardUser, 'role-prefixes.sync', req.guild.id, result)
				.catch(error => console.error('[Dashboard audit]', error.message))
			res.json(result)
		} catch (error) { respondError(res, error) }
		finally { prefixSyncs.delete(req.guild.id) }
	})
	app.post('/api/permanent-message/publish', async (req, res) => {
		try {
			const { kind, channelId, revision } = req.body
			if (!channelId || !Number.isSafeInteger(revision)) throw problem(400, 'Выберите канал и обновите данные.')
			await permanent.publish(kind, channelId, revision, client, req.guild, req.dashboardUser)
			res.json(store.snapshot())
		} catch (error) { respondError(res, error) }
	})
	app.post('/api/navigation/sync', async (req, res) => {
		try {
			const syncResults = await navigation.sync(client, req.guild)
			await store.audit(req.dashboardUser, 'message.sync', 'navigation', { syncResults })
			res.json({ ...store.snapshot(), syncResults })
		} catch (error) { respondError(res, error) }
	})
	app.post('/api/permanent-message', async (req, res) => {
		try {
			const { kind, link, revision } = req.body
			if (!Object.hasOwn(permanent.definitions, kind) || !Number.isSafeInteger(revision)) throw problem(400, 'Проверьте вид сообщения и обновите данные.')
			const binding = link ? permanent.bindingFor(kind, await fetchOwnedMessage(link, req.guild)) : null
			if (binding) await permanent.fetchMessage(client, req.guild, link)
			const id = binding && parseMessageLink(link).messageId
			if (id && Object.entries(store.bindings).some(([other, value]) => other !== kind && parseMessageLink(value.link).messageId === id)) throw problem(400, 'Сообщение уже привязано к другому разделу.')
			await store.save('bindings', { [kind]: binding }, revision, req.dashboardUser)
			res.json(store.snapshot())
		} catch (error) { respondError(res, error) }
	})
	app.post('/api/permanent-message/sync', async (req, res) => {
		try {
			if (!Object.hasOwn(permanent.definitions, req.body.kind) || !store.bindings[req.body.kind]) throw problem(400, 'Сначала привяжите сообщение.')
			await store.audit(req.dashboardUser, 'message.sync.request', req.body.kind)
			const syncResults = await permanent.syncMessages([], client, req.guild, req.body.kind, req.dashboardUser)
			await store.audit(req.dashboardUser, 'message.sync', req.body.kind, { syncResults })
				.catch(error => console.error('[Dashboard] Не удалось записать результат обновления:', error.message))
			res.json({ ...store.snapshot(), syncResults })
		} catch (error) { respondError(res, error) }
	})
	app.get('/api/history', async (req, res) => {
		try { res.json(await store.history()) } catch (error) { respondError(res, error) }
	})
	async function fetchOwnedMessage(link, guild) {
		const ids = parseMessageLink(link)
		if (ids.guildId !== guild.id) throw problem(403, 'Сообщение другого сервера.')
		const channel = await guild.channels.fetch(ids.channelId)
		if (!channel?.messages) throw problem(400, 'Нужен текстовый канал.')
		const message = await channel.messages.fetch({ message: ids.messageId, force: true, cache: false })
		if (message.author.id !== client.user.id || message.webhookId) throw problem(403, 'Редактировать можно только сообщения этого бота.')
		const dynamic = await pool.query('SELECT 1 FROM active_captures WHERE message_id = $1 LIMIT 1', [message.id])
		const war = await pool.query('SELECT 1 FROM family_wars WHERE announcement_id = $1 OR registration_id = $1 LIMIT 1', [message.id])
		if (channel.id === store.getSetting('ARCHIVE_SETTINGS_CHANNEL')) throw problem(409, 'Списки архивов обновляет бот. Их оформление недоступно для изменения.')
		if (dynamic.rows.length || war.rows.length) throw problem(409, 'Этот список обновляет бот. Измените регистрацию во вкладке «Шаблоны».')
		return message
	}
}

function respondError(res, error) {
	res.status(error.status || 502).json({ error: error.status ? error.message : 'Не удалось выполнить запрос. Проверьте доступ бота к каналу и базе данных.' })
}

module.exports = { registerDashboard, validateTemplates, validateSettings }
