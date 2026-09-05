let items = []

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
		large: false,
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

function updateItemData(id, field, value) {
	const item = items.find(item => item.id === id)
	if (item) {
		item[field] = value
		updatePreview()
	}
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

		let html = `<div class="item-card-header">
      <span>#${index + 1} — ${labelName}</span>
      <button class="btn-delete" onclick="deleteItem('${item.id}')">Удалить</button>
    </div>`

		if (item.type === 'text') {
			html += `<textarea placeholder="Введите текст сообщения... (Поддерживает Markdown)" oninput="updateItemData('${item.id}', 'value', this.value)">${item.value}</textarea>`
		} else if (item.type === 'image') {
			html += `<input type="text" placeholder="Вставьте прямую URL-ссылку на изображение..." value="${item.value}" oninput="updateItemData('${item.id}', 'value', this.value)">`
		} else if (item.type === 'separator') {
			html += `<label class="checkbox-container"><input type="checkbox" ${item.large ? 'checked' : ''} onchange="updateItemData('${item.id}', 'large', this.checked)"> Сделать большим пустым отступом (Скроет серую линию)</label>`
		} else if (item.type === 'section') {
			html += `
        <textarea placeholder="Введите основной текст секции (слева)..." oninput="updateItemData('${item.id}', 'value', this.value)">${item.value}</textarea>
        <div style="display:flex; gap:10px;">
          <input type="text" placeholder="Текст на кнопке" value="${item.btnLabel}" oninput="updateItemData('${item.id}', 'btnLabel', this.value)">
          <input type="text" placeholder="Ссылка (https://...)" value="${item.btnLink}" oninput="updateItemData('${item.id}', 'btnLink', this.value)">
        </div>
      `
		}

		card.innerHTML = html
		if (item.type === 'image') card.style.borderLeftColor = '#9b59b6'
		if (item.type === 'separator') card.style.borderLeftColor = '#e67e22'
		if (item.type === 'section') card.style.borderLeftColor = '#3498db'

		container.appendChild(card)
	})
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
			div.innerText = item.value
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
			const div = document.createElement('div')
			div.className = item.large
				? 'discord-separator large-spacing'
				: 'discord-separator'
			preview.appendChild(div)
		} else if (item.type === 'section') {
			const rowDiv = document.createElement('div')
			rowDiv.className = 'discord-section-row'

			const textDiv = document.createElement('div')
			textDiv.className = 'discord-text'
			textDiv.innerText = item.value || ''
			rowDiv.appendChild(textDiv)

			if (item.btnLabel) {
				const btn = document.createElement('a')
				btn.className = 'discord-btn'
				btn.innerText = item.btnLabel
				rowDiv.appendChild(btn)
			}

			preview.appendChild(rowDiv)
		}
	})
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
