let items = []
let channelResolveTimer = null

// Инициализация обработчиков после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
	document
		.getElementById('accentColor')
		.addEventListener('input', updatePreview)
	document
		.getElementById('noColor')
		.addEventListener('change', e => toggleColorInput(e.target.checked))

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

	updatePreview()
})

function toggleColorInput(disabled) {
	document.getElementById('accentColor').disabled = disabled
	updatePreview()
}

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
	items.push(itemObj)

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
	container.innerHTML = ''

	items.forEach((item, index) => {
		const card = document.createElement('div')
		card.className = 'item-card'

		let labelName = item.type.toUpperCase()
		if (item.type === 'section') labelName = 'СЕКЦИЯ (КНОПКА СПРАВА)'
		if (item.type === 'separator') labelName = 'РАЗДЕЛИТЕЛЬ / ОТСТУП'
		if (item.type === 'image') labelName = 'ИЗОБРАЖЕНИЕ (МЕДИА)'

		const isFirst = index === 0
		const isLast = index === items.length - 1

		let html = `<div class="item-card-header">
      <span>#${index + 1} — ${labelName}</span>
      <div class="item-header-actions">
        <button type="button" class="btn-move" title="Вверх" ${isFirst ? 'disabled' : ''} onclick="moveItem('${item.id}', -1)">↑</button>
        <button type="button" class="btn-move" title="Вниз" ${isLast ? 'disabled' : ''} onclick="moveItem('${item.id}', 1)">↓</button>
        <button class="btn-delete" onclick="deleteItem('${item.id}')">Удалить</button>
      </div>
    </div>`

		if (item.type === 'text') {
			html += `<textarea class="auto-resize" placeholder="Введите текст сообщения... (Поддерживает Markdown: # ## ### **жирный** *курсив* ~~зачёркнутый~~ \`код\` \`\`\`блок\`\`\`)" oninput="updateItemData('${item.id}', 'value', this.value); autoResizeTextarea(this)">${escapeHtml(item.value)}</textarea>`
		} else if (item.type === 'image') {
			html += `<input type="text" placeholder="Вставьте прямую URL-ссылку на изображение..." value="${escapeAttr(item.value)}" oninput="updateItemData('${item.id}', 'value', this.value)">`
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
          <input type="checkbox" ${spacing === 'large' ? 'checked' : ''} onchange="updateItemData('${item.id}', 'spacing', this.checked ? 'large' : 'small')">
          Большой отступ по высоте (Large)
        </label>
        <label class="checkbox-container">
          <input type="checkbox" ${divider ? 'checked' : ''} onchange="updateItemData('${item.id}', 'divider', this.checked)">
          Показывать серую линию-разделитель
        </label>
      </div>`
		} else if (item.type === 'section') {
			html += `
        <textarea class="auto-resize" placeholder="Введите основной текст секции (слева)... (Markdown поддерживается)" oninput="updateItemData('${item.id}', 'value', this.value); autoResizeTextarea(this)">${escapeHtml(item.value)}</textarea>
        <div style="display:flex; gap:10px;">
          <input type="text" placeholder="Текст на кнопке" value="${escapeAttr(item.btnLabel)}" oninput="updateItemData('${item.id}', 'btnLabel', this.value)">
          <input type="text" placeholder="Ссылка (https://...)" value="${escapeAttr(item.btnLink)}" oninput="updateItemData('${item.id}', 'btnLink', this.value)">
        </div>
      `
		}

		card.innerHTML = html
		if (item.type === 'image') card.style.borderLeftColor = '#9b59b6'
		if (item.type === 'separator') card.style.borderLeftColor = '#e67e22'
		if (item.type === 'section') card.style.borderLeftColor = '#3498db'

		container.appendChild(card)

		// auto-resize after insert
		card.querySelectorAll('textarea.auto-resize').forEach(ta => {
			autoResizeTextarea(ta)
		})
	})
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

/**
 * Простой Discord-подобный markdown → HTML для превью.
 * Поддерживает: # ## ###, **bold**, *italic*, __underline__, ~~strike~~,
 * `inline code`, ```code blocks```, ссылки.
 */
function discordMarkdownToHtml(text) {
	if (!text) return ''

	// Сначала экранируем HTML
	let s = String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')

	// Code blocks (``` ... ```) — до inline, чтобы не ломать содержимое
	s = s.replace(/```([\s\S]*?)```/g, (_, code) => {
		return '<pre><code>' + code.replace(/^\n/, '') + '</code></pre>'
	})

	// Inline code
	s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')

	// Headings (в начале строки)
	s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>')
	s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>')
	s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>')

	// Bold ** ** or __ __ (underline is __ in Discord for underline, ** for bold)
	// Discord: **bold** *italic* __underline__ ~~strikethrough~~
	s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
	s = s.replace(/__(.+?)__/g, '<u>$1</u>')
	s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
	s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')

	// Simple URLs
	s = s.replace(
		/(https?:\/\/[^\s<]+)/g,
		'<a href="$1" target="_blank" rel="noopener">$1</a>'
	)

	// Newlines → <br> but not inside pre
	// Split by pre blocks
	const parts = s.split(/(<pre>[\s\S]*?<\/pre>)/)
	s = parts
		.map(part => {
			if (part.startsWith('<pre>')) return part
			return part.replace(/\n/g, '<br>')
		})
		.join('')

	return s
}

function updatePreview() {
	const preview = document.getElementById('discordPreview')
	const color = document.getElementById('accentColor').value
	const noColor = document.getElementById('noColor').checked

	if (noColor) {
		preview.classList.add('no-border')
	} else {
		preview.classList.remove('no-border')
		preview.style.borderLeftColor = color
	}

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

async function sendToDiscord() {
	const channelId = document.getElementById('channelId').value.trim()
	const accentColor = document.getElementById('accentColor').value
	const noColor = document.getElementById('noColor').checked

	if (!channelId) {
		alert('❌ Пожалуйста, заполните ID текстового канала Discord!')
		return
	}

	if (items.length === 0) {
		alert('❌ Добавьте хотя бы один элемент перед отправкой!')
		return
	}

	localStorage.setItem('reventobot_channelId', channelId)

	try {
		const response = await fetch('/api/send-container', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ channelId, noColor, accentColor, items })
		})

		const result = await response.json()
		if (result.success) {
			alert('✅ Отлично! Ваш контейнер успешно опубликован в канале Discord.')
		} else {
			alert('❌ Ошибка отправки: ' + result.error)
		}
	} catch (err) {
		alert('❌ Ошибка соединения с сервером бота: ' + err.message)
	}
}
