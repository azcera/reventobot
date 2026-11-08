// A source editor with explicit Edit / Preview switching.
function mountMarkdownEditor(textarea, options = {}) {
	const shell = document.createElement('div'); shell.className = 'markdown-editor'
	textarea.before(shell)
	const tabs = document.createElement('div'); tabs.className = 'markdown-tabs'; tabs.setAttribute('role', 'tablist')
	const toolbar = document.createElement('div'); toolbar.className = 'markdown-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Форматирование Markdown')
	const preview = document.createElement('div'); preview.className = 'markdown-preview discord-text'; preview.hidden = true
	shell.append(tabs, toolbar, textarea, preview)
	const snapshot = () => ({ value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd, direction: textarea.selectionDirection })
	let history = [snapshot()], historyIndex = 0, restoring = false
	function rememberSelection() {
		// Loading another message starts a fresh history, independent of the previous document.
		if (history[historyIndex].value !== textarea.value) { history = [snapshot()]; historyIndex = 0 }
		else history[historyIndex] = snapshot()
	}
	function restore(redo) {
		if (textarea.disabled || textarea.readOnly) return
		const next = historyIndex + (redo ? 1 : -1)
		if (!history[next]) return
		const state = history[next], scrollTop = textarea.scrollTop
		historyIndex = next
		textarea.value = state.value
		textarea.focus()
		textarea.setSelectionRange(state.start, state.end, state.direction)
		textarea.scrollTop = scrollTop
		restoring = true
		try { textarea.dispatchEvent(new Event('input', { bubbles: true })) }
		finally { restoring = false }
	}
	textarea.addEventListener('beforeinput', event => {
		if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
			if (event.cancelable) { event.preventDefault(); rememberSelection(); restore(event.inputType === 'historyRedo') }
		} else rememberSelection()
	})
	textarea.addEventListener('input', () => {
		if (restoring || history[historyIndex].value === textarea.value) return
		history.splice(historyIndex + 1)
		history.push(snapshot())
		if (history.length > 100) history.shift()
		historyIndex = history.length - 1
	})
	shell.addEventListener('keydown', event => {
		if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return
		const key = event.key.toLowerCase()
		if (key !== 'z' && key !== 'y') return
		if (textarea.disabled || textarea.readOnly || textarea.hidden) return
		event.preventDefault()
		rememberSelection()
		restore(key === 'y' || event.shiftKey)
	})
	function button(label, title, run, parent = toolbar) {
		const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title)
		b.addEventListener('click', run); parent.append(b); return b
	}
	function insert(before, after = '', sample = 'текст', line = false) {
		const start = textarea.selectionStart, end = textarea.selectionEnd, selected = textarea.value.slice(start, end) || sample
		const prefix = line && start && textarea.value[start - 1] !== '\n' ? '\n' : ''
		const suffix = line && textarea.value[end] !== '\n' ? '\n' : ''
		const content = line && !after && before ? selected.split('\n').map(text => before + text).join('\n') : before + selected + after
		const value = prefix + content + suffix
		if (textarea.maxLength > 0 && textarea.value.length - (end - start) + value.length > textarea.maxLength) return
		rememberSelection()
		textarea.setRangeText(value, start, end, 'select'); textarea.focus(); textarea.dispatchEvent(new Event('input', { bubbles: true }))
	}
	const formats = [
		['B', 'Полужирный', '**', '**'], ['I', 'Курсив', '*', '*'], ['U', 'Подчёркнутый', '__', '__'], ['S', 'Зачёркнутый', '~~', '~~'],
		['H1', 'Заголовок 1', '# ', '', 'Заголовок', true], ['H2', 'Заголовок 2', '## ', '', 'Заголовок', true], ['H3', 'Заголовок 3', '### ', '', 'Заголовок', true],
		['−#', 'Мелкая подпись', '-# ', '', 'подпись', true], ['❯', 'Цитата', '> ', '', 'цитата', true], ['•', 'Маркированный список', '- ', '', 'пункт', true], ['1.', 'Нумерованный список', '1. ', '', 'пункт', true],
		['Спойлер', 'Скрытый текст', '||', '||'], ['<>', 'Код в строке', '`', '`'], ['```', 'Блок кода (после ``` можно указать язык)', '```\n', '\n```', 'код', true],
		['Ссылка', 'Ссылка', '[', '](https://example.com)', 'подпись'],
	]
	for (const [label, title, ...args] of formats) button(label, title, () => insert(...args))
	if (options.components !== false) {
		button('Разделитель', 'Обычный разделитель', () => insert('', '', '---', true))
		button('Большой разделитель', 'Разделитель с большим отступом', () => insert('', '', '***', true))
		button('Изображение', 'Изображение по прямой ссылке', () => insert('', '', '<img src="https://example.com/image.png" />', true))
		button('Секция + кнопка', 'Текст с кнопкой справа', () => insert('<section buttonLabel="Открыть" buttonLink="https://example.com">', '</section>', 'Текст секции', true))
	}
	const edit = button('Edit', 'Редактирование', () => mode(false), tabs)
	const view = button('Preview', 'Предпросмотр', () => mode(true), tabs)
	function mode(show) {
		textarea.hidden = toolbar.hidden = show; preview.hidden = !show
		edit.setAttribute('role', 'tab'); view.setAttribute('role', 'tab'); edit.setAttribute('aria-selected', String(!show)); view.setAttribute('aria-selected', String(show))
		if (show) {
			try { preview.innerHTML = options.render ? options.render(textarea.value) : renderComponentMarkdown(textarea.value, options.components !== false) }
			catch (error) { preview.textContent = error.message }
		}
	}
	tabs.hidden = options.tabs === false
	mode(false)
	return shell
}
function renderComponentMarkdown(source, components = true) {
	if (!components) return discordMarkdownToHtml(source)
	const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
	return componentMarkdown.parse(source).map(item => {
		if (item.type === 'text') return '<div class="discord-text">' + discordMarkdownToHtml(item.value) + '</div>'
		if (item.type === 'image' && item.value.startsWith('attachment://')) return '<img class="markdown-image" src="/template-images/' + escape(item.value.slice(13)) + '" alt="Изображение сообщения">'
		if (item.type === 'image') return '<img class="markdown-image" src="' + escape(item.value) + '" alt="Изображение сообщения" loading="lazy">'
		if (item.type === 'separator') return '<hr class="markdown-separator' + (item.divider ? '' : ' no-line') + (item.spacing === 'large' ? ' spacing-large' : '') + '">'
		return '<div class="markdown-section"><div>' + discordMarkdownToHtml(item.value) + '</div><span class="preview-button discord-btn">' + escape(item.btnLabel) + '</span></div>'
	}).join('')
}
