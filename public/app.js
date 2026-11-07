let items = []
let channelResolveTimer = null
let messageSource = null
let requestPending = false
let dashboardCsrf = ''

// Инициализация обработчиков после загрузки DOM
document.addEventListener('DOMContentLoaded', async () => {
	document
		.getElementById('addTextBtn')
		.addEventListener('click', () => addItem('text'))
	document
		.getElementById('addImageBtn')
		.addEventListener('click', () => addItem('image'))
	document
		.getElementById('addSeparatorBtn')
		.addEventListener('click', () => addItem('separator'))
	document
		.getElementById('addSectionBtn')
		.addEventListener('click', () => addItem('section'))

	document.getElementById('sendBtn').addEventListener('click', sendToDiscord)
	document.getElementById('loadMessageBtn').addEventListener('click', loadMessage)
	document.getElementById('saveMessageBtn').addEventListener('click', () => sendToDiscord(true))
	document.getElementById('detachMessageBtn').addEventListener('click', () => {
		messageSource = null
		updateMessageMode()
		setMessageStatus('Режим нового сообщения. Компоненты сохранены в билдере.')
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
	updatePreview()
	renderInputs()
})

function addItem(type) {
	const id = Date.now() + Math.random().toString(36).substr(2, 5)
	let itemObj = {
		id,
		type,
		value: '',
		spacing: 'small',
		divider: true,
		btnLabel: '',
		btnLink: ''
	}
	const afterId = document.getElementById('insertAfter').value
	const afterIndex = items.findIndex(item => item.id === afterId)
	items.splice(afterIndex < 0 ? items.length : afterIndex + 1, 0, itemObj)

	renderInputs()
	updatePreview()
}

function duplicateItem(id) {
	const index = items.findIndex(item => item.id === id)
	if (index < 0) return
	items.splice(index + 1, 0, {
		...items[index],
		id: Date.now() + Math.random().toString(36).substr(2, 5)
	})
	renderInputs()
	updatePreview()
}

function deleteItem(id) {
	items = items.filter(item => item.id !== id)
	renderInputs()
	updatePreview()
}

function moveItem(id, direction) {
	const idx = items.findIndex(item => item.id === id)
	if (idx < 0) return
	const newIdx = idx + direction
	if (newIdx < 0 || newIdx >= items.length) return
	const [moved] = items.splice(idx, 1)
	items.splice(newIdx, 0, moved)
	renderInputs()
	updatePreview()
}

function updateItemData(id, field, value) {
	const item = items.find(item => item.id === id)
	if (item) {
		item[field] = value
		updatePreview()
	}
}

function autoResizeTextarea(el) {
	if (!el) return
	el.style.height = 'auto'
	el.style.height = Math.max(70, el.scrollHeight) + 'px'
}

function renderInputs() {
	const container = document.getElementById('itemsContainer')
	const scrollTop = container.scrollTop
	const insertAfter = document.getElementById('insertAfter')
	const afterId = insertAfter.value
	insertAfter.replaceChildren(new Option('В конец контейнера', ''))
	items.forEach((item, index) => {
		const names = { text: 'Текст', image: 'Изображение', separator: 'Разделитель', section: 'Секция' }
		insertAfter.add(new Option(`После #${index + 1} — ${names[item.type]}`, item.id))
	})
	insertAfter.value = items.some(item => item.id === afterId) ? afterId : ''
	document.getElementById('componentCount').textContent = `Компоненты: ${items.length}`
	container.innerHTML = ''
	if (items.length === 0) {
		container.innerHTML = '<p class="empty-state">Начните с текста или изображения. Выберите место вставки, чтобы добавить компонент между существующими.</p>'
	}

	items.forEach((item, index) => {
		const card = document.createElement('div')
		card.className = 'item-card'

		let labelName = item.type === 'text' ? 'ТЕКСТ' : item.type.toUpperCase()
		if (item.type === 'section') labelName = 'СЕКЦИЯ (КНОПКА СПРАВА)'
		if (item.type === 'separator') labelName = 'РАЗДЕЛИТЕЛЬ / ОТСТУП'
		if (item.type === 'image') labelName = 'ИЗОБРАЖЕНИЕ (МЕДИА)'

		const isFirst = index === 0
		const isLast = index === items.length - 1

		let html = `<div class="item-card-header">
      <span>#${index + 1} — ${labelName}</span>
      <div class="item-header-actions">
        <button type="button" class="btn-move" title="Вверх" ${isFirst ? 'disabled' : ''} data-action="move" data-direction="-1">↑</button>
        <button type="button" class="btn-move" title="Вниз" ${isLast ? 'disabled' : ''} data-action="move" data-direction="1">↓</button>
        <button type="button" class="btn-copy" data-action="copy">Копия</button>
        <button class="btn-delete" data-action="delete">Удалить</button>
      </div>
    </div>`

		if (item.type === 'text') {
			html += `<textarea class="auto-resize" placeholder="Введите текст сообщения... (Поддерживает Markdown: # ## ### **жирный** *курсив* ~~зачёркнутый~~ \`код\` \`\`\`блок\`\`\`)" data-field="value">${escapeHtml(item.value)}</textarea>`
		} else if (item.type === 'image') {
			html += `<input type="text" placeholder="Вставьте прямую URL-ссылку на изображение..." value="${escapeAttr(item.value)}" data-field="value">`
		} else if (item.type === 'separator') {
			const spacing = item.spacing || (item.large ? 'large' : 'small')
			const divider =
				typeof item.divider === 'boolean'
					? item.divider
					: item.large
						? false
						: true
			html += `<div class="separator-options">
        <label class="checkbox-container">
          <input type="checkbox" ${spacing === 'large' ? 'checked' : ''} data-field="spacing">
          Большой отступ по высоте (Large)
        </label>
        <label class="checkbox-container">
          <input type="checkbox" ${divider ? 'checked' : ''} data-field="divider">
          Показывать серую линию-разделитель
        </label>
      </div>`
		} else if (item.type === 'section') {
			html += `
        <textarea class="auto-resize" placeholder="Введите основной текст секции (слева)... (Markdown поддерживается)" data-field="value">${escapeHtml(item.value)}</textarea>
        <div style="display:flex; gap:10px;">
          <input type="text" placeholder="Текст на кнопке" value="${escapeAttr(item.btnLabel)}" data-field="btnLabel">
          <input type="text" placeholder="Ссылка (https://...)" value="${escapeAttr(item.btnLink)}" data-field="btnLink">
        </div>
      `
		}

		card.innerHTML = html
		card.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
			if (button.dataset.action === 'move') moveItem(item.id, Number(button.dataset.direction))
			if (button.dataset.action === 'copy') duplicateItem(item.id)
			if (button.dataset.action === 'delete') deleteItem(item.id)
		}))
		card.querySelectorAll('[data-field]').forEach(input => input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
			const field = input.dataset.field
			updateItemData(item.id, field, field === 'divider' ? input.checked : field === 'spacing' ? input.checked ? 'large' : 'small' : input.value)
			if (input.tagName === 'TEXTAREA') autoResizeTextarea(input)
		}))

		container.appendChild(card)

		// auto-resize after insert
		card.querySelectorAll('textarea.auto-resize').forEach(ta => {
			autoResizeTextarea(ta)
		})
	})
	container.scrollTop = scrollTop
}

function escapeHtml(str) {
	if (!str) return ''
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function escapeAttr(str) {
	if (!str) return ''
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}


function updatePreview() {
	const preview = document.getElementById('discordPreview')
	preview.classList.add('no-border')

	preview.innerHTML = ''

	if (items.length === 0) {
		preview.innerHTML =
			'<div style="color:var(--text-muted); text-align:center; padding: 20px 0; font-size: 14px;">Контейнер пуст. Добавьте элементы кнопками слева.</div>'
		return
	}

	items.forEach(item => {
		if (item.type === 'text' && item.value) {
			const div = document.createElement('div')
			div.className = 'discord-text'
			div.innerHTML = discordMarkdownToHtml(item.value)
			preview.appendChild(div)
		} else if (item.type === 'image' && item.value) {
			const img = document.createElement('img')
			img.className = 'discord-image-preview'
			img.src = item.value
			img.onerror = function () {
				this.style.display = 'none'
			}
			preview.appendChild(img)
		} else if (item.type === 'separator') {
			const spacing = item.spacing || (item.large ? 'large' : 'small')
			const divider =
				typeof item.divider === 'boolean'
					? item.divider
					: item.large
						? false
						: true
			const div = document.createElement('div')
			div.className =
				'discord-separator' +
				(divider ? '' : ' no-line') +
				(spacing === 'large' ? ' spacing-large' : ' spacing-small')
			preview.appendChild(div)
		} else if (item.type === 'section') {
			const rowDiv = document.createElement('div')
			rowDiv.className = 'discord-section-row'

			const textDiv = document.createElement('div')
			textDiv.className = 'discord-text'
			textDiv.innerHTML = discordMarkdownToHtml(item.value || '')
			rowDiv.appendChild(textDiv)

			if (item.btnLabel) {
				const btn = document.createElement('a')
				btn.className = 'discord-btn'
				btn.innerText = item.btnLabel
				if (item.btnLink) btn.href = item.btnLink
				rowDiv.appendChild(btn)
			}

			preview.appendChild(rowDiv)
		}
	})
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
	if (items.length && !confirm('Загрузка заменит компоненты в билдере. Продолжить?')) return
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
		document.getElementById('insertAfter').value = ''
		renderInputs()
		document.getElementById('itemsContainer').scrollTop = 0
		updatePreview()
		setMessageStatus(messageSource.canEdit
			? 'Загружено: ' + messageSource.url + '. Измените компоненты и сохраните оригинал.'
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
