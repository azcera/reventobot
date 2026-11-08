let items = []
let channelResolveTimer = null
let messageSource = null
let requestPending = false
let dashboardCsrf = ''

// Инициализация обработчиков после загрузки DOM
document.addEventListener('DOMContentLoaded', async () => {
	mountMarkdownEditor(document.getElementById('markdownSource'))

	document.getElementById('sendBtn').addEventListener('click', sendToDiscord)
	document.getElementById('loadMessageBtn').addEventListener('click', loadMessage)
	document.getElementById('saveMessageBtn').addEventListener('click', () => sendToDiscord(true))
	document.getElementById('detachMessageBtn').addEventListener('click', () => {
		messageSource = null
		updateMessageMode()
		setMessageStatus('Режим нового сообщения. Черновик сохранён в редакторе.')
	})

	const channelInput = document.getElementById('channelId')
	const savedId = localStorage.getItem('reventobot_channelId')
	if (savedId) {
		channelInput.value = savedId
		resolveChannelName(savedId)
	}

	channelInput.addEventListener('input', () => {
		const val = channelInput.value.trim()
		localStorage.setItem('reventobot_channelId', val)
		resolveChannelName(val)
	})
	channelInput.addEventListener('blur', () => {
		const val = channelInput.value.trim()
		localStorage.setItem('reventobot_channelId', val)
	})

	try {
		const session = await fetch('/api/session').then(response => response.json())
		if (!session.csrf) throw new Error(session.error || 'Войдите через Discord в дашборде.')
		dashboardCsrf = session.csrf
		const resources = await fetch('/api/resources').then(response => response.json())
		discordMentions.setResources(resources)
		const list = document.getElementById('channelOptions')
		for (const channel of resources.channels || []) if ([0, 5].includes(channel.type) && channel.canSend) list.appendChild(new Option('#' + channel.name, channel.id))

	} catch (error) {
		setMessageStatus(error.message, true)
		document.getElementById('sendBtn').disabled = true
		document.getElementById('loadMessageBtn').disabled = true
	}
})

function renderInputs() {
	document.getElementById('markdownSource').value = componentMarkdown.stringify(items)
}

function resolveChannelName(channelId) {
	const hint = document.getElementById('channelNameHint')
	if (channelResolveTimer) clearTimeout(channelResolveTimer)

	if (!channelId || !/^\d{17,20}$/.test(channelId)) {
		hint.textContent = ''
		hint.className = 'channel-name-hint'
		return
	}

	hint.textContent = 'Поиск канала…'
	hint.className = 'channel-name-hint loading'

	channelResolveTimer = setTimeout(async () => {
		try {
			const res = await fetch(
				'/api/channel-info?id=' + encodeURIComponent(channelId)
			)
			const data = await res.json()
			if (data.success && data.name) {
				hint.textContent = '#' + data.name
				hint.className = 'channel-name-hint'
			} else {
				hint.textContent = data.error || 'Канал не найден'
				hint.className = 'channel-name-hint error'
			}
		} catch (e) {
			hint.textContent = 'Не удалось проверить канал'
			hint.className = 'channel-name-hint error'
		}
	}, 400)
}

function setMessageStatus(text, error = false) {
	const status = document.getElementById('messageStatus')
	status.textContent = text
	status.classList.toggle('error', error)
}

function updateMessageMode() {
	const save = document.getElementById('saveMessageBtn')
	save.hidden = !messageSource
	save.disabled = requestPending || !messageSource?.canEdit
	document.getElementById('detachMessageBtn').hidden = !messageSource
	document.getElementById('sendBtn').textContent = messageSource ? 'Отправить копию' : 'Опубликовать в Discord ↗'
}

function beginRequest() {
	requestPending = true
	const controls = [...document.querySelectorAll('input, textarea, select, button')]
	const disabled = controls.map(control => control.disabled)
	controls.forEach(control => { control.disabled = true })
	return () => {
		controls.forEach((control, index) => { control.disabled = disabled[index] })
		requestPending = false
		updateMessageMode()
	}
}

async function loadMessage() {
	if (requestPending) return
	const link = document.getElementById('messageLink').value.trim()
	if (!link) {
		setMessageStatus('Вставьте ссылку на сообщение Discord.', true)
		return
	}
	if (document.getElementById('markdownSource').value.trim() && !confirm('Загрузка заменит компоненты в билдере. Продолжить?')) return
	const finish = beginRequest()
	setMessageStatus('Загружаю сообщение из Discord…')
	try {
		const response = await fetch('/api/container-message?link=' + encodeURIComponent(link))
		const result = await response.json()
		if (!response.ok || !result.success) throw new Error(result.error || 'Не удалось загрузить сообщение.')
		items = result.items
		messageSource = result.source
		document.getElementById('channelId').value = messageSource.channelId
		localStorage.setItem('reventobot_channelId', messageSource.channelId)
		resolveChannelName(messageSource.channelId)
		renderInputs()
		document.querySelector('.markdown-tabs button').click()
		setMessageStatus(messageSource.canEdit
			? 'Загружено: ' + messageSource.url + '. Измените Markdown и сохраните оригинал.'
			: 'Сообщение загружено. Автор — другой бот или webhook: доступна только отправка копии.')
	} catch (error) {
		setMessageStatus(error.message, true)
	} finally { finish() }
}

async function sendToDiscord(edit = false) {
	// Обработчик click передаёт MouseEvent; сохранение вызывается только с true.
	edit = edit === true
	if (requestPending) return
	if (edit && !messageSource?.canEdit) return
	const channelId = document.getElementById('channelId').value.trim()
	const noColor = true

	if (!edit && !channelId) {
		alert('❌ Пожалуйста, заполните ID текстового канала Discord!')
		return
	}

	try { items = componentMarkdown.parse(document.getElementById('markdownSource').value) }
	catch (error) { setMessageStatus(error.message, true); return }

	if (items.length === 0) {
		alert('❌ Добавьте хотя бы один элемент перед отправкой!')
		return
	}

	localStorage.setItem('reventobot_channelId', channelId)

	const finish = beginRequest()
	setMessageStatus(edit ? 'Сохраняю изменения…' : 'Отправляю сообщение…')
	try {
		const response = await fetch(edit ? '/api/edit-container' : '/api/send-container', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': dashboardCsrf },
			body: JSON.stringify({
				channelId, noColor, items,
				...(edit ? { link: messageSource.url, revision: messageSource.revision } : {})
			})
		})

		const result = await response.json()
		if (response.ok && result.success) {
			if (edit) messageSource = result.source
			setMessageStatus((edit ? 'Изменения сохранены в исходном сообщении.' : 'Сообщение опубликовано в Discord.') + (result.logError ? ' ' + result.logError : ''), Boolean(result.logError))
		} else {
			setMessageStatus(result.error || 'Не удалось отправить сообщение.', true)
		}
	} catch (err) {
		setMessageStatus('Ошибка соединения с сервером бота: ' + err.message, true)
	} finally { finish() }
}
