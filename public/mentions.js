// Shared by the builder, template editor and message editor.
const discordMentions = (() => {
	let resources = { channels: [], roles: [] }
	let menu, activeInput, activeQuery
	let matches = [], selected = 0

	function queryAt(value, start, end = start) {
		if (start !== end) return null
		const before = value.slice(0, start)
		// Do not complete inside code, existing mentions, URLs or Markdown headings.
		if (before.replace(/```[\s\S]*?```|`[^`\n]*`/g, '').includes('`')) return null
		const match = /(?:^|[\s(])([@#])([^\s@#<>`]*)$/.exec(before)
		if (!match || match[1] === '#' && /^\s*#$/.test(before.slice(before.lastIndexOf('\n') + 1))) return null
		return { kind: match[1], text: match[2], start: start - match[2].length - 1, end: start }
	}

	function suggestions(query) {
		if (!query) return []
		const list = query.kind === '@' ? resources.roles : resources.channels.filter(channel => channel.type !== 4)
		const search = query.text.toLowerCase()
		return list.filter(item => item.name.toLowerCase().includes(search) || item.id.includes(search)).slice(0, 20)
	}

	function close() {
		menu?.remove()
		menu = activeInput = activeQuery = null
		matches = []
	}

	function highlight() {
		Array.from(menu.children).forEach((button, index) => {
			button.setAttribute('aria-selected', String(index === selected))
			if (index === selected) button.scrollIntoView({ block: 'nearest' })
		})
	}

	function choose(index) {
		const input = activeInput, query = activeQuery, item = matches[index]
		if (!input || !item) return
		const mention = query.kind === '@' ? `<@&${item.id}>` : `<#${item.id}>`
		input.setRangeText(mention + ' ', query.start, query.end, 'end')
		close()
		input.focus()
		input.dispatchEvent(new Event('input', { bubbles: true }))
	}

	function refresh(input) {
		close()
		if (input?.tagName !== 'TEXTAREA' || input.disabled || input.readOnly) return
		const query = queryAt(input.value, input.selectionStart, input.selectionEnd)
		const found = suggestions(query)
		if (!found.length) return
		activeInput = input
		activeQuery = query
		matches = found
		selected = 0
		menu = document.createElement('div')
		menu.className = 'mention-suggestions'
		menu.setAttribute('role', 'listbox')
		menu.setAttribute('aria-label', query.kind === '@' ? 'Роли сервера' : 'Каналы сервера')
		for (const [index, item] of matches.entries()) {
			const button = document.createElement('button')
			button.type = 'button'
			button.tabIndex = -1
			button.setAttribute('role', 'option')
			button.textContent = query.kind + item.name
			button.title = item.id
			button.addEventListener('pointerdown', event => event.preventDefault())
			button.addEventListener('click', () => choose(index))
			menu.appendChild(button)
		}
		const rect = input.getBoundingClientRect()
		const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16)
		menu.style.width = width + 'px'
		menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px'
		menu.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - Math.min(280, matches.length * 40 + 8) - 8)) + 'px'
		document.body.appendChild(menu)
		highlight()
	}

	document.addEventListener('input', event => refresh(event.target))
	document.addEventListener('click', event => {
		if (!menu?.contains(event.target)) refresh(event.target)
	})
	document.addEventListener('focusout', event => { if (event.target === activeInput) close() })
	document.addEventListener('scroll', event => { if (!menu?.contains(event.target)) close() }, true)
	document.addEventListener('keydown', event => {
		if (!menu || event.target !== activeInput || event.isComposing) return
		if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
			event.preventDefault()
			selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
			highlight()
		} else if (['Enter', 'Tab'].includes(event.key)) {
			event.preventDefault()
			choose(selected)
		} else if (event.key === 'Escape') {
			event.preventDefault()
			close()
		} else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) close()
	})

	return {
		queryAt, suggestions,
		setResources(value) {
			resources = { channels: value.channels || [], roles: value.roles || [] }
			setDiscordMentionResources(resources)
			close()
		}
	}
})()
