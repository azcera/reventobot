const $ = id => document.getElementById(id)
let session
let config
let resources
let currentMessage
const templateDrafts = new Map()
let settingsDraft = {}
let busy = false
let applicationPreviewState = 'pending'
const titles = { overview: 'Обзор', builder: 'Конструктор v2', templates: 'Шаблоны сообщений', messages: 'Сообщения в Discord', settings: 'Настройки', history: 'История изменений', majestic: 'Majestic — синхронизация' }
let builderResizeObserver
let templateResizeObserver
$('builderFrame').addEventListener('load', () => {
	builderResizeObserver?.disconnect()
	const frame = $('builderFrame')
	const layout = frame.contentDocument?.querySelector('.builder-layout')
	if (!layout) return
	const resize = () => {
		const height = Math.ceil(layout.getBoundingClientRect().height)
		if (height > 0) frame.style.height = (height + frame.offsetHeight - frame.clientHeight) + 'px'
	}
	builderResizeObserver = new ResizeObserver(resize)
	builderResizeObserver.observe(layout)
	resize()
})

function node(tag, text, className) {
	const element = document.createElement(tag)
	if (text != null) element.textContent = text
	if (className) element.className = className
	return element
}
function notice(text, error = false) {
	$('notice').hidden = false
	$('notice').textContent = text
	$('notice').classList.toggle('error', error)
}
async function api(path, body) {
	const response = await fetch('/api/' + path, body === undefined ? {} : {
		method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf || '' }, body: JSON.stringify(body)
	})
	const result = await response.json()
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			$('dashboard').hidden = true
			$('login').hidden = false
			$('loginStatus').textContent = result.error
		}
		throw new Error(result.error || 'Не удалось выполнить запрос.')
	}
	return result
}
async function action(work) {
	if (busy) return
	busy = true
	const buttons = [...document.querySelectorAll('button')]
	const previous = buttons.map(button => button.disabled)
	buttons.forEach(button => { button.disabled = true })
	try { await work() } catch (error) { notice(error.message, true) }
	finally { buttons.forEach((button, index) => { button.disabled = previous[index] }); busy = false }
}
function renderHistory(id, entries) {
	const root = $(id)
	root.replaceChildren()
	if (!entries.length) root.append(node('p', 'Изменений пока нет.', 'empty'))
	const actions = { templates: 'Обновление шаблона', settings: 'Обновление настроек', 'message.edit': 'Сообщение изменено', 'message.edit.request': 'Запрос изменения сообщения', 'container.send': 'Публикация контейнера', 'container.send.request': 'Запрос публикации', 'container.edit': 'Контейнер изменён', 'container.edit.request': 'Запрос изменения контейнера' }
	for (const entry of entries) {
		const row = node('div', null, 'history-row')
		const time = node('time', new Date(entry.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))
		time.dateTime = entry.created_at
		const info = node('div', actions[entry.action] || entry.action)
		const details = typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details || {}
		info.append(node('small', (details.actorName || 'Имя не сохранено') + ' · Discord ID: ' + entry.actor))
		const names = { rules: 'Правила', promotion: 'Система повышения', recruit: 'Памятка рекрута', invite: 'Приглашение' }
		if (entry.action === 'bindings') info.firstChild.textContent = 'Изменение привязки постоянного сообщения'
		if (entry.action === 'message.change') info.firstChild.textContent = 'Изменено сообщение: ' + (names[details.kind] || details.kind)
		if (entry.action.startsWith('message.sync')) info.firstChild.textContent = entry.action.endsWith('.request') ? 'Запрошено обновление в Discord' : 'Результат обновления в Discord'
		if (entry.action.endsWith('.failed')) info.firstChild.textContent = 'Не удалось изменить сообщение'
		if (details.error) info.append(node('small', details.error, 'error'))
		const changes = Array.isArray(details.fields) ? {} : { ...(details.fields || {}) }
		for (const [key, after] of Object.entries(details.changes || {})) changes[key] = { label: config?.templates.find(field => field.key === key)?.label || key, before: details.before?.[key], after }
		for (const [key, change] of Object.entries(changes)) {
			const expand = node('details')
			expand.append(node('summary', change.label || key))
			const format = value => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'Не задано')
			expand.append(node('pre', 'Было:\n' + format(change.before) + '\n\nСтало:\n' + format(change.after)))
			info.append(expand)
		}
		if (details.diff) { const expand = node('details'); expand.append(node('summary', 'Изменённые строки'), node('pre', details.diff)); info.append(expand) }
		if (details.outcome) info.append(node('small', details.outcome))
		if (details.logError) info.append(node('small', details.logError, 'error'))
		for (const result of details.syncResults || []) info.append(node('small', (names[result.kind] || result.kind) + ': ' + (result.ok ? 'Обновлено' : result.error) + (result.logError ? ' · ' + result.logError : '')))
		const targetLabel = names[entry.target] || entry.target.split(', ').map(key => config?.templates.find(field => field.key === key)?.label || config?.settings.find(field => field.key === key)?.label || key).join(', ')
		const target = /^https:\/\/discord.com\/channels\//.test(entry.target) ? node('a', 'Открыть сообщение ↗') : node('span', targetLabel)
		if (target.tagName === 'A') { target.href = entry.target; target.target = '_blank'; target.rel = 'noopener' }
		row.append(time, info, target)
		root.append(row)
	}
}
async function overview() {
	const data = await api('overview')
	$('metrics').replaceChildren()
	for (const [title, value, good] of [['Discord', data.ready ? 'Подключён' : 'Отключён', data.ready], ['Задержка API', data.ping >= 0 ? data.ping + ' мс' : 'Измеряется', false], ['База данных', data.database ? 'Доступна' : 'Недоступна', data.database], ['Время работы', Math.floor(data.uptime / 3600) + ' ч ' + Math.floor(data.uptime % 3600 / 60) + ' мин', false]]) {
		const metric = node('div', null, 'metric' + (good ? ' good' : ''))
		metric.append(node('span', title), node('strong', value))
		$('metrics').append(metric)
	}
	renderHistory('recentHistory', data.history)
}
async function switchTab() {
	const tab = location.hash.slice(1) || 'overview'
	if (!titles[tab] || !session) return
	document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== tab })
	document.querySelectorAll('[data-tab]').forEach(link => link.classList.toggle('active', link.dataset.tab === tab))
	$('pageTitle').textContent = titles[tab]
	$('notice').hidden = true
	try {
		if (tab === 'overview') await overview()
		if (tab === 'builder' && !$('builderFrame').getAttribute('src')) $('builderFrame').src = '/builder.html'
		if (tab === 'history') renderHistory('historyRows', await api('history'))
		if (tab === 'majestic') await loadMajestic()
	} catch (error) { notice(error.message, true) }
}
async function loadConfig() {
	[config, resources] = await Promise.all([api('config'), api('resources')])
	discordMentions.setResources(resources)
	templateDrafts.clear()
	settingsDraft = Object.fromEntries(config.settings.map(setting => [setting.key, setting.value]))
	renderTemplateGroups()
	renderTemplates()
	renderSettings()
	renderPermanentMessages()
}
function renderTemplateGroups() {
	const select = $('templateGroup')
	const previous = select.value
	select.replaceChildren()
	for (const group of new Set(config.templates.map(field => field.group))) select.add(new Option(group, group))
	if ([...select.options].some(option => option.value === previous)) select.value = previous
}
const permanentGroups = { rules: 'Правила', invite: 'Приглашение', promotion: 'Система повышения', recruit: 'Памятка рекрута' }
function renderPermanentMessages() {
	const root = $('permanentMessages')
	root.replaceChildren(node('h3', 'Постоянные сообщения'))
	root.append(node('p', 'Выбери канал: бот опубликует сохранённый шаблон и запомнит сообщение. В том же канале обновляется существующее сообщение. При выборе другого канала прежняя копия остаётся без дальнейшей синхронизации.', 'muted'))
	for (const [kind, group] of Object.entries(permanentGroups)) {
		const form = node('form', null, 'permanent-row')
		const channelLabel = node('label', group)
		const channel = node('select')
		channel.add(new Option('Выберите канал', ''))
		for (const resource of resources.channels.filter(channel => [0, 5].includes(channel.type) && channel.canSend)) channel.add(new Option('# ' + resource.name, resource.id))
		channel.value = config.bindings?.[kind]?.link.split('/')[5] || ''
		channelLabel.append(channel); form.append(channelLabel)
		const publish = node('button', 'Опубликовать / обновить', 'quiet'); publish.type = 'button'
		publish.addEventListener('click', () => {
			if (!channel.value) return notice('Выберите канал публикации.', true)
			if (isTemplateDirty(group)) return notice('Сначала сохраните изменения шаблона.', true)
			action(async () => {
				config = await api('permanent-message/publish', { kind, channelId: channel.value, revision: config.revision })
				templateDrafts.delete(group); renderTemplateGroups(); renderPermanentMessages(); renderTemplates()
				notice('Шаблон опубликован. Сообщение сохранено для дальнейших обновлений.')
			})
		}); form.append(publish)
		if (config.bindings?.[kind]) {
			const link = node('a', 'Открыть сообщение ↗'); link.href = config.bindings[kind].link; link.target = '_blank'; link.rel = 'noopener'; form.append(link)
		}
		const advanced = node('details'); advanced.append(node('summary', 'Привязать существующее сообщение по ссылке'))
		const label = node('label', 'Ссылка на сообщение')
		const input = node('input'); input.type = 'url'; input.placeholder = 'https://discord.com/channels/…/…/…'; input.value = config.bindings?.[kind]?.link || ''
		label.append(input); advanced.append(label)
		const bind = node('button', 'Сохранить привязку', 'quiet'); bind.type = 'submit'; advanced.append(bind); form.append(advanced)
		form.addEventListener('submit', event => {
			event.preventDefault()
			if (isTemplateDirty(group) && !confirm('Изменение привязки сбросит несохранённые правки этого раздела. Продолжить?')) return
			action(async () => { config = await api('permanent-message', { kind, link: input.value.trim(), revision: config.revision }); templateDrafts.delete(group); renderTemplateGroups(); renderPermanentMessages(); if ([...$('templateGroup').options].some(option => option.value === group)) $('templateGroup').value = group; renderTemplates(); notice(input.value.trim() ? 'Привязка сохранена. Шаблон можно редактировать ниже.' : 'Привязка удалена.') })
		})
		if (config.bindings?.[kind]) {
			const open = node('button', 'Открыть шаблон', 'quiet'); open.type = 'button'
			open.addEventListener('click', () => { $('templateGroup').value = group; renderTemplates() }); form.append(open)
			const sync = node('button', 'Обновить в Discord', 'quiet'); sync.type = 'button'
			sync.addEventListener('click', () => action(async () => { config = await api('permanent-message/sync', { kind }); showSyncResult('Сообщение обновлено.') })); form.append(sync)
		}
		root.append(form)
	}
	const syncNavigation = node('button', 'Обновить навигацию во всех архивах', 'quiet'); syncNavigation.type = 'button'
	syncNavigation.addEventListener('click', () => action(async () => {
		if (isTemplateDirty('Навигация')) return notice('Сначала сохраните изменения навигации.', true)
		notice('Обновляется навигация. Поиск и обновление сообщений могут занять время.')
		config = await api('navigation/sync', {})
		showSyncResult('Навигация обновлена. Сообщений: ' + (config.syncResults[0]?.updated || 0) + '.')
	})); root.append(syncNavigation)
	root.append(node('p', 'Сохранение шаблона навигации обновляет её копии в главном канале архивов и ветках. Приветствие личного архива и кнопка поиска сохраняются.', 'muted'))
}
function showSyncResult(success) {
	const failed = (config.syncResults || []).filter(result => !result.ok)
	const logErrors = (config.syncResults || []).filter(result => result.logError)
	if (!failed.length && logErrors.length) return notice(success + ' ' + logErrors.map(result => result.logError).join(' '), true)
	notice(failed.length ? 'Шаблон сохранён, но обновление в Discord не завершено: ' + failed.map(result => (permanentGroups[result.kind] || 'Навигация') + ': ' + result.error).join(' ') + ' Повторите обновление после устранения причины.' : success, failed.length > 0)
}
const examples = { confirmedCount: '1', confirmedPlayers: '1. @Tony', waitingCount: '2', waitingPlayers: '1. @Alex\n2. @Sam', leftCount: '0', leftPlayers: 'Пусто', page: '1', pages: '1', map: 'Лес', zone: 'A1', status: 'active', mode: 'по роли и времени записи', registrationStatus: 'Время и состав обновляются автоматически.', freshness: '', user: '123456789012345678', name: 'Tony | 132961', age: '18', about: 'Хочу развиваться вместе с семьёй', history: 'Revento', admin: '123456789012345678', server: 'REVENTO', channel: '123456789012345678', time: '18:00 МСК', target: 'капт', count: '3', limit: '20', players: '1. @Tony\n2. @Alex\n3. @Sam', reason: 'Ошибка в анкете', part: '2' }
function preview(root, fields, values, variables = false) {
	root.replaceChildren()
	for (const field of fields) {
		let value = values[field.key ?? field.path] ?? field.value
		if (variables) value = value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => examples[name] ?? match)
		if (field.type === 'color') { root.style.borderLeftColor = value || 'transparent'; continue }
		if (field.type === 'url') {
			if (/attachment:\/\//.test(value)) root.append(node('p', '▧ ' + value.slice(13), 'muted'))
			else root.append(node('p', value, 'muted'))
			continue
		}
		if (field.type === 'button' || field.label === 'Подпись кнопки') { root.append(node('span', value, 'preview-button')); continue }
		const block = node('div', null, 'preview-field')
		block.classList.add('discord-text')
		block.innerHTML = typeof renderComponentMarkdown === 'function' ? renderComponentMarkdown(value, field.components !== false) : discordMarkdownToHtml(value)
		root.append(block)
	}
}
function setupPreviewTabs(form, render) {
	const layout = form.parentElement
	const aside = layout.querySelector('aside')
	let tabs = layout.previousElementSibling
	if (!tabs?.classList.contains('editor-mode-tabs')) {
		tabs = node('div', null, 'markdown-tabs editor-mode-tabs')
		layout.before(tabs)
	}
	tabs.replaceChildren()
	const mode = show => {
		form.hidden = show; aside.hidden = !show
		layout.classList.add('single-editor')
		for (const [index, button] of [...tabs.children].entries()) button.setAttribute('aria-selected', String(index === (show ? 1 : 0)))
		if (show) { try { render() } catch (error) { aside.querySelector('.message-preview').textContent = error.message } }
	}
	for (const [title, show] of [['Edit', false], ['Preview', true]]) {
		const button = node('button', title); button.type = 'button'; button.setAttribute('role', 'tab')
		button.addEventListener('click', () => mode(show)); tabs.append(button)
	}
	tabs.setAttribute('role', 'tablist'); mode(false)
}
function fieldsForm(root, fields, values, onInput) {
	root.replaceChildren()
	for (const field of fields) {
		const key = field.key ?? field.path
		const label = node('label', field.label || 'Текст')
		const input = node(field.type === 'text' ? 'textarea' : 'input')
		input.value = values[key] ?? field.value
		input.maxLength = field.maxLength
		if (input.tagName === 'INPUT') input.type = field.type === 'url' && !input.value.startsWith('attachment://') ? 'url' : 'text'
		input.addEventListener('input', () => { values[key] = input.value; onInput() })
		input.id = 'field-' + key.replace(/[^a-zA-Z0-9_-]/g, '-')
		label.htmlFor = input.id
		label.append(input)
		label.dataset.key = key
		if (field.variables?.length) label.append(node('span', 'Сохраняй переменные: ' + field.variables.map(name => '{' + name + '}').join(', '), 'hint'))
		root.append(label)
		if (input.tagName === 'TEXTAREA' && typeof mountMarkdownEditor === 'function') mountMarkdownEditor(input, { components: field.components !== false, render: source => renderComponentMarkdown(source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => examples[name] ?? match), field.components !== false) })
	}
}
function groupFields() { return config.templates.filter(field => field.group === $('templateGroup').value) }
function groupDraft() {
	const group = $('templateGroup').value
	if (!templateDrafts.has(group)) templateDrafts.set(group, Object.fromEntries(groupFields().map(field => [field.key, field.value])))
	return templateDrafts.get(group)
}
function templateEditorFields(group = $('templateGroup').value) {
	const fields = config.templates.filter(field => field.group === group)
	if (group !== 'Правила') {
		const order = group === 'Приглашение' ? ['invite.document', 'invite.3', 'invite.4'] : group === 'Регистрация на капт' ? ['capture.title', 'capture.time', 'capture.info', 'capture.sort', 'capture.confirmed', 'capture.waiting', 'capture.2', 'capture.3', 'capture.sortTime', 'capture.sortPriority'] : []
		return fields.sort((a, b) => order.length ? order.indexOf(a.key) - order.indexOf(b.key) : Number(b.key.includes('.document')) - Number(a.key.includes('.document')))
	}
	const document = fields.find(field => field.key === 'rules.document')
	return [document || { key: 'rules.document', type: 'text', label: 'Правила целиком', value: fields.filter(field => /^rules\.(heading|rule)\./.test(field.key)).map(field => field.value).join('\n\n---\n\n'), variables: [] }]
}
function isTemplateDirty(group) {
	const values = templateDrafts.get(group)
	if (!values) return false
	const fields = templateEditorFields(group)
	return fields.some(field => values[field.key] !== undefined && values[field.key] !== field.value)
}
function readTemplateDocument() { return groupDraft() }
function renderTemplates() {
	const fields = templateEditorFields(), values = groupDraft(), root = $('templateFields')
	templateResizeObserver?.disconnect()
	root.replaceChildren()
	const inputs = []
	for (const field of fields) {
		const label = node('label', field.label || 'Текст сообщения')
		const input = node(field.type === 'text' ? 'textarea' : 'input')
		input.id = inputs.length ? 'templateSource-' + inputs.length : 'templateSource'
		values[field.key] ??= field.value
		input.value = values[field.key]
		input.maxLength = field.maxLength || 16000
		label.htmlFor = input.id; label.append(input); root.append(label)
		const resize = () => { if (input.clientWidth) { input.style.height = 'auto'; input.style.height = (input.scrollHeight + input.offsetHeight - input.clientHeight) + 'px' } }
		input.addEventListener('input', () => { values[field.key] = input.value; resize() })
		if (field.type === 'text' && typeof mountMarkdownEditor === 'function') mountMarkdownEditor(input, { tabs: false, components: field.components !== false })
		if (field.variables?.length) root.append(node('p', 'Переменные: ' + field.variables.map(name => '{' + name + '}').join(', '), 'hint'))
		inputs.push({ input, resize })
	}
	const update = () => {
		if (['Заявка', 'Личные сообщения заявок'].includes($('templateGroup').value)) return previewApplication($('templatePreview'), values)
		previewTemplate($('templatePreview'), fields, values)
	}
	if ($('templateForm')) setupPreviewTabs($('templateForm'), update)
	templateResizeObserver = new ResizeObserver(() => inputs.forEach(({ resize }) => resize()))
	for (const { input, resize } of inputs) { templateResizeObserver.observe(input); resize() }
}
function previewTemplate(root, fields, values) {
	const group = $('templateGroup').value
	if (group === 'Приглашение') {
		preview(root, fields.filter(field => field.key === 'invite.document'), values, true)
		const section = node('div', null, 'markdown-section discord-text')
		section.append(node('div'), node('span', values['invite.4'], 'preview-button'))
		section.children[0].innerHTML = discordMarkdownToHtml(values['invite.3'])
		root.append(node('hr', null, 'markdown-separator spacing-large'), section)
		return
	}
	if (group === 'Регистрация на капт') {
		const text = key => values['capture.' + key] ?? fields.find(field => field.key === 'capture.' + key)?.value ?? ''
		fields = [{ type: 'text', value: [text('title') + '\n\n' + text('time') + '\n\n' + text('info'), text('sort') + '\n\n' + text('confirmed'), text('waiting')].join('\n\n---\n\n') }, ...['2', '3', 'sortTime'].map(key => fields.find(field => field.key === 'capture.' + key)).filter(Boolean)]
	}
	if (group === 'Обычная регистрация') fields = ['document', 'sortTime', 'join', 'leave', 'editTime'].map(key => fields.find(field => field.key === 'registration.' + key)).filter(Boolean)
	preview(root, fields, values, true)
}
function previewApplication(root, values) {
	root.replaceChildren()
	const dm = $('templateGroup').value === 'Личные сообщения заявок'
	const states = dm ? { accepted: 'Принята', rejected: 'Отклонена', interview: 'Обзвон' } : { pending: 'На рассмотрении', accepted: 'Принята', rejected: 'Отклонена', interview: 'Обзвон' }
	if (!states[applicationPreviewState]) applicationPreviewState = Object.keys(states)[0]
	const select = node('select')
	select.setAttribute('aria-label', 'Состояние заявки в предпросмотре')
	for (const [key, label] of Object.entries(states)) select.add(new Option(label, key))
	select.value = applicationPreviewState
	select.addEventListener('change', () => { applicationPreviewState = select.value; previewApplication(root, values) })
	root.append(select, node('p', 'Пример сообщения · Tony | 132961', 'muted'))
	const container = node('div', null, 'application-preview-container')
	const sample = { ...examples, admin: '987654321098765432', time: String(Math.floor(Date.now() / 1000)) }
	const text = key => (values[key] ?? config.templates.find(field => field.key === key)?.value ?? '').replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => sample[name] || match)
	const display = content => {
		const block = node('div', null, 'discord-text')
		// Resolve sample mentions and timestamps before the safe Markdown renderer.
		content = content.replace(/<t:\d+:[A-Za-z]>/g, match => match.endsWith(':R>') ? 'только что' : new Date(Number(sample.time) * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))
			.replace(/<@!?\d+>/g, mention => mention.includes(sample.admin) ? '@Куратор' : '@Tony').replace(/<#\d+>/g, mention => mention.includes(examples.channel) ? '#Обзвон' : mention)
		block.innerHTML = typeof renderComponentMarkdown === 'function' ? renderComponentMarkdown(content) : discordMarkdownToHtml(content)
		container.append(block)
	}
	const separator = () => container.append(node('div', null, 'discord-separator'))
	const state = applicationPreviewState
	display(text((dm ? 'dm' : 'application') + '.document.' + state))
	if (!dm && state === 'pending') {
		separator()
		const buttons = node('div', null, 'application-preview-buttons')
		for (const key of ['application.1', 'application.2', 'application.3']) buttons.append(node('span', text(key), 'preview-button'))
		container.append(buttons)
	}
	root.append(container)
}
function renderSettings() {
	$('settingFields').replaceChildren()
	for (const field of config.settings) {
		const container = node('div')
		const label = node('label', field.label)
		container.append(label)
		if (field.type === 'rolePrefixes') {
			container.append(node('small', 'Формат: [Dep]. При нескольких ролях используется первый префикс. Пробел после него добавляется автоматически. Кнопка ниже сохранит префиксы и обновит ники всех участников с указанными ролями. Ники длиннее 32 символов и участники, которых бот не может переименовать, будут пропущены.'))
			const rows = node('div')
			const draw = () => {
				rows.replaceChildren()
				settingsDraft[field.key].forEach((entry, index) => {
					const row = node('div', null, 'selected-row prefix-row')
					const select = node('select'); select.setAttribute('aria-label', 'Роль для префикса')
					select.add(new Option('Выберите роль…', ''))
					for (const role of resources.roles) select.add(new Option('@' + role.name, role.id))
					if (entry.roleId && !resources.roles.some(role => role.id === entry.roleId)) select.add(new Option('Удалённая роль · ' + entry.roleId, entry.roleId))
					select.value = entry.roleId
					const input = node('input'); input.type = 'text'; input.maxLength = 24; input.placeholder = '[Dep]'; input.value = entry.prefix
					input.setAttribute('aria-label', 'Префикс')
					const update = () => { settingsDraft[field.key] = settingsDraft[field.key].map((item, i) => i === index ? { roleId: select.value, prefix: input.value } : item) }
					select.addEventListener('change', update); input.addEventListener('input', update)
					row.append(select, input)
					for (const [text, offset] of [['↑', -1], ['↓', 1], ['×', 0]]) {
						const button = node('button', text); button.type = 'button'
						button.setAttribute('aria-label', offset === 0 ? 'Удалить префикс' : offset < 0 ? 'Повысить приоритет' : 'Понизить приоритет')
						button.disabled = offset !== 0 && (index + offset < 0 || index + offset >= settingsDraft[field.key].length)
						button.addEventListener('click', () => {
							const entries = [...settingsDraft[field.key]]
							if (offset === 0) entries.splice(index, 1)
							else [entries[index], entries[index + offset]] = [entries[index + offset], entries[index]]
							settingsDraft[field.key] = entries; draw()
						})
						row.append(button)
					}
					rows.append(row)
				})
			}
			const add = node('button', 'Добавить префикс'); add.type = 'button'
			add.addEventListener('click', () => { settingsDraft[field.key] = [...settingsDraft[field.key], { roleId: '', prefix: '' }]; draw() })
			const sync = node('button', 'Сохранить префиксы и обновить всех в Discord'); sync.type = 'button'
			sync.addEventListener('click', () => action(async () => {
				config = await api('settings', { revision: config.revision, values: { [field.key]: settingsDraft[field.key] } })
				notice('Префиксы сохранены. Обновление участников в Discord…')
				try {
					const result = await api('role-prefixes/sync', {})
					notice(`Обновлено: ${result.updated}. Уже актуальны: ${result.unchanged}. Пропущено (права или длина ника): ${result.skipped}. Ошибок: ${result.failed}.`, result.failed > 0 || result.skipped > 0)
				} catch (error) { throw new Error('Префиксы сохранены, но обновление участников не завершено: ' + error.message) }
			}))
			container.append(rows, add, sync); draw()
		} else if (field.type === 'boolean') {
			const input = node('input')
			input.type = 'checkbox'; input.checked = settingsDraft[field.key]
			input.addEventListener('change', () => { settingsDraft[field.key] = input.checked })
			label.className = 'boolean-label'; label.prepend(input)
		} else if (field.type === 'color') {
			const input = node('input'); input.type = 'color'; input.value = settingsDraft[field.key]
			input.addEventListener('input', () => { settingsDraft[field.key] = input.value }); label.append(input)
		} else {
			const multiple = ['roles', 'channels'].includes(field.type)
			const items = field.type.startsWith('role') ? resources.roles : resources.channels.filter(channel => field.channelTypes.includes(channel.type))
			const select = node('select')
			select.add(new Option(multiple ? 'Добавить…' : 'Не выбран', ''))
			for (const item of items) select.add(new Option((field.type.startsWith('role') ? '@' : '#') + item.name, item.id))
			label.append(select)
			if (multiple) {
				const rows = node('div')
				const draw = () => {
					rows.replaceChildren()
					const selected = String(settingsDraft[field.key]).split(',').map(id => id.trim()).filter(Boolean)
					selected.forEach((id, index) => {
						const row = node('div', null, 'selected-row'); row.append(node('span', items.find(item => item.id === id)?.name || id))
						for (const [text, direction] of [['↑', -1], ['↓', 1], ['×', 0]]) {
							const button = node('button', text); button.type = 'button'; button.setAttribute('aria-label', text === '×' ? 'Удалить' : text === '↑' ? 'Поднять' : 'Опустить')
							button.disabled = direction === -1 && index === 0 || direction === 1 && index === selected.length - 1
							button.addEventListener('click', () => {
								if (!direction) selected.splice(index, 1)
								else [selected[index], selected[index + direction]] = [selected[index + direction], selected[index]]
								settingsDraft[field.key] = selected.join(','); draw()
							}); row.append(button)
						} rows.append(row)
					})
				}
				select.addEventListener('change', () => {
					const selected = String(settingsDraft[field.key]).split(',').map(id => id.trim()).filter(Boolean)
					if (select.value && !selected.includes(select.value)) selected.push(select.value)
					settingsDraft[field.key] = selected.join(','); select.value = ''; draw()
				}); container.append(rows); draw()
			} else {
				const value = String(settingsDraft[field.key])
				if (value && !items.some(item => item.id === value)) select.add(new Option('Недоступен: ' + value, value))
				select.value = value; select.addEventListener('change', () => { settingsDraft[field.key] = select.value })
			}
		}
		$('settingFields').append(container)
	}
}
function renderMessage() {
	const values = Object.fromEntries(currentMessage.fields.map(field => [field.path, field.value]))
	currentMessage.values = values
	fieldsForm($('messageFields'), currentMessage.fields, values, () => {})
	setupPreviewTabs($('messageForm'), () => preview($('messagePreview'), currentMessage.fields, values))
	$('messageEditor').hidden = false
}

$('templateGroup').addEventListener('change', renderTemplates)
for (const id of ['reloadConfig', 'reloadSettings']) $(id).addEventListener('click', () => {
	if (confirm('Загрузить сохранённые данные? Несохранённые правки шаблонов и настроек будут сброшены.')) action(async () => { await loadConfig(); notice('Данные обновлены.') })
})
$('templateForm').addEventListener('submit', event => {
	event.preventDefault()
	action(async () => {
		readTemplateDocument()
		const values = Object.fromEntries(templateEditorFields().filter(field => groupDraft()[field.key] !== field.value).map(field => [field.key, groupDraft()[field.key]]))
		if (!Object.keys(values).length) return notice('Нет изменений для сохранения.')
		config = await api('templates', { revision: config.revision, values }); templateDrafts.delete($('templateGroup').value); renderTemplates(); showSyncResult('Шаблон сохранён. Привязанные сообщения обновлены в Discord.')
	})
})
$('resetTemplate').addEventListener('click', () => {
	if (!confirm('Восстановить исходный шаблон этого раздела?')) return
	action(async () => { config = await api('templates', { revision: config.revision, values: Object.fromEntries(groupFields().map(field => [field.key, null])) }); templateDrafts.delete($('templateGroup').value); renderTemplates(); showSyncResult('Исходный шаблон восстановлен, привязанные сообщения обновлены.') })
})
$('settingsForm').addEventListener('submit', event => {
	event.preventDefault()
	action(async () => {
		const values = Object.fromEntries(config.settings.filter(field => JSON.stringify(field.value) !== JSON.stringify(settingsDraft[field.key])).map(field => [field.key, settingsDraft[field.key]]))
		if (!Object.keys(values).length) return notice('Нет изменений для сохранения.')
		config = await api('settings', { revision: config.revision, values }); notice('Настройки сохранены и применены.')
	})
})
$('loadMessageForm').addEventListener('submit', event => {
	event.preventDefault()
	action(async () => {
		$('messageEditor').hidden = true; currentMessage = null
		currentMessage = await api('message?link=' + encodeURIComponent($('editMessageLink').value.trim()))
		renderMessage(); notice('Сообщение загружено. Изменение не затронет шаблон будущих сообщений.')
	})
})
$('messageForm').addEventListener('submit', event => {
	event.preventDefault()
	action(async () => {
		if (!currentMessage) return
		const values = Object.fromEntries(currentMessage.fields.filter(field => currentMessage.values[field.path] !== field.value).map(field => [field.path, currentMessage.values[field.path]]))
		if (!Object.keys(values).length) return notice('Нет изменений для сохранения.')
		currentMessage = await api('message', { link: currentMessage.url, revision: currentMessage.revision, values }); renderMessage(); notice('Сообщение обновлено в Discord.' + (currentMessage.logError ? ' ' + currentMessage.logError : ''), Boolean(currentMessage.logError))
	})
})
$('refreshHistory').addEventListener('click', () => action(async () => renderHistory('historyRows', await api('history'))))
$('logout').addEventListener('click', () => action(async () => { await api('logout', {}); location.assign('/') }))
window.addEventListener('hashchange', switchTab)
window.addEventListener('beforeunload', event => {
	if (!config) return
	const dirty = [...templateDrafts.keys()].some(isTemplateDirty) || config.settings.some(field => JSON.stringify(settingsDraft[field.key]) !== JSON.stringify(field.value)) || currentMessage?.fields.some(field => currentMessage.values[field.path] !== field.value)
	if (dirty) { event.preventDefault(); event.returnValue = '' }
})
async function start() {
	initMajestic()
	const error = new URLSearchParams(location.search).get('error')
	if (error) { $('loginStatus').textContent = error; history.replaceState(null, '', location.pathname) }
	try {
		const status = await fetch('/auth/status').then(response => response.json())
		if (!status.configured) {
			$('loginStatus').textContent = 'Для входа настройте CLIENT_ID, DISCORD_CLIENT_SECRET (или CLIENT_SECRET), GUILD_ID и DASHBOARD_URL в окружении сервера.'
			$('loginButton').hidden = true; return
		}
		if (!error) $('loginStatus').textContent = 'Войдите с аккаунтом администратора сервера.'
		session = await api('session')
		$('userName').textContent = session.user.name; $('guildName').textContent = session.guild.name
		await loadConfig()
		$('login').hidden = true; $('dashboard').hidden = false
		await switchTab()
	} catch (error) {
		if (!$('login').hidden) $('loginStatus').textContent = error.message
		else notice(error.message, true)
	}
}
start()
