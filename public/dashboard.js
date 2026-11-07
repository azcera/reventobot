const $ = id => document.getElementById(id)
let session
let config
let resources
let currentMessage
const templateDrafts = new Map()
let settingsDraft = {}
let busy = false
const titles = { overview: 'Обзор', builder: 'Конструктор v2', templates: 'Шаблоны сообщений', messages: 'Сообщения в Discord', settings: 'Настройки', history: 'История изменений' }
let builderResizeObserver
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
		info.append(node('small', 'Discord ID: ' + entry.actor))
		const target = /^https:\/\/discord.com\/channels\//.test(entry.target) ? node('a', 'Открыть сообщение ↗') : node('span', entry.target)
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
	} catch (error) { notice(error.message, true) }
}
async function loadConfig() {
	[config, resources] = await Promise.all([api('config'), api('resources')])
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
	root.append(node('p', 'Укажи ссылку один раз. Привязки сохраняются после перезапуска бота.', 'muted'))
	for (const [kind, group] of Object.entries(permanentGroups)) {
		const form = node('form', null, 'permanent-row')
		const label = node('label', group)
		const input = node('input'); input.type = 'url'; input.placeholder = 'https://discord.com/channels/…/…/…'; input.value = config.bindings?.[kind]?.link || ''
		label.append(input); form.append(label)
		const bind = node('button', 'Сохранить привязку', 'quiet'); bind.type = 'submit'; form.append(bind)
		form.addEventListener('submit', event => {
			event.preventDefault()
			if (config.templates.some(field => field.group === group && templateDrafts.get(group)?.[field.key] !== undefined && templateDrafts.get(group)[field.key] !== field.value) && !confirm('Изменение привязки сбросит несохранённые правки этого раздела. Продолжить?')) return
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
}
function showSyncResult(success) {
	const failed = (config.syncResults || []).filter(result => !result.ok)
	notice(failed.length ? 'Шаблон сохранён, но обновление в Discord не завершено: ' + failed.map(result => permanentGroups[result.kind] + ': ' + result.error).join(' ') + ' Нажми «Обновить в Discord» после устранения причины.' : success, failed.length > 0)
}
const examples = { user: '123456789012345678', name: 'Tony | 132961', age: '18', about: 'Хочу развиваться вместе с семьёй', history: 'Revento', admin: '123456789012345678', server: 'REVENTO', channel: '123456789012345678', time: '18:00 МСК', target: 'капт', count: '3', limit: '20', players: '1. @Tony\n2. @Alex\n3. @Sam', reason: 'Ошибка в анкете', part: '2' }
function preview(root, fields, values, variables = false) {
	root.replaceChildren()
	for (const field of fields) {
		let value = values[field.key ?? field.path] ?? field.value
		if (variables) value = value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => examples[name] || match)
		if (field.type === 'color') { root.style.borderLeftColor = value || 'transparent'; continue }
		if (field.type === 'url') {
			if (/attachment:\/\//.test(value)) root.append(node('p', '▧ ' + value.slice(13), 'muted'))
			else root.append(node('p', value, 'muted'))
			continue
		}
		if (field.type === 'button' || field.label === 'Подпись кнопки') { root.append(node('span', value, 'preview-button')); continue }
		const block = node('div', null, 'preview-field')
		block.classList.add('discord-text')
		block.innerHTML = discordMarkdownToHtml(value)
		root.append(block)
	}
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
		label.append(input)
		if (field.variables?.length) label.append(node('span', 'Сохраняй переменные: ' + field.variables.map(name => '{' + name + '}').join(', '), 'hint'))
		root.append(label)
	}
}
function groupFields() { return config.templates.filter(field => field.group === $('templateGroup').value) }
function groupDraft() {
	const group = $('templateGroup').value
	if (!templateDrafts.has(group)) templateDrafts.set(group, Object.fromEntries(groupFields().map(field => [field.key, field.value])))
	return templateDrafts.get(group)
}
function renderTemplates() {
	const fields = groupFields()
	const values = groupDraft()
	const update = () => preview($('templatePreview'), fields, values, true)
	fieldsForm($('templateFields'), fields, values, update)
	update()
}
function renderSettings() {
	$('settingFields').replaceChildren()
	for (const field of config.settings) {
		const container = node('div')
		const label = node('label', field.label)
		container.append(label)
		if (field.type === 'boolean') {
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
	fieldsForm($('messageFields'), currentMessage.fields, values, () => preview($('messagePreview'), currentMessage.fields, values))
	preview($('messagePreview'), currentMessage.fields, values)
	$('messageEditor').hidden = false
}

$('templateGroup').addEventListener('change', renderTemplates)
for (const id of ['reloadConfig', 'reloadSettings']) $(id).addEventListener('click', () => {
	if (confirm('Загрузить сохранённые данные? Несохранённые правки шаблонов и настроек будут сброшены.')) action(async () => { await loadConfig(); notice('Данные обновлены.') })
})
$('templateForm').addEventListener('submit', event => {
	event.preventDefault()
	action(async () => {
		const values = Object.fromEntries(groupFields().filter(field => groupDraft()[field.key] !== field.value).map(field => [field.key, groupDraft()[field.key]]))
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
		const values = Object.fromEntries(config.settings.filter(field => field.value !== settingsDraft[field.key]).map(field => [field.key, settingsDraft[field.key]]))
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
		currentMessage = await api('message', { link: currentMessage.url, revision: currentMessage.revision, values }); renderMessage(); notice('Сообщение обновлено в Discord.')
	})
})
$('refreshHistory').addEventListener('click', () => action(async () => renderHistory('historyRows', await api('history'))))
$('logout').addEventListener('click', () => action(async () => { await api('logout', {}); location.assign('/') }))
window.addEventListener('hashchange', switchTab)
window.addEventListener('beforeunload', event => {
	if (!config) return
	const dirty = config.templates.some(field => templateDrafts.get(field.group)?.[field.key] !== undefined && templateDrafts.get(field.group)[field.key] !== field.value) || config.settings.some(field => settingsDraft[field.key] !== field.value) || currentMessage?.fields.some(field => currentMessage.values[field.path] !== field.value)
	if (dirty) { event.preventDefault(); event.returnValue = '' }
})
async function start() {
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
