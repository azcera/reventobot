/**
 * Простой Discord-подобный markdown → HTML для превью.
 * Заголовки, подписи, цитаты, спойлеры и подсветка блоков кода.
 */
function discordCodeHighlight(code, language) {
	const span = (kind, value) => '<span class="code-' + kind + '">' + value + '</span>'
	language = language.toLowerCase()
	if (language === 'ansi') {
		let foreground = null, background = null, bold = false, underline = false
		const colors = ['#4f545c', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#ffffff']
		const paint = value => {
			const style = [foreground && 'color:' + foreground, background && 'background-color:' + background, bold && 'font-weight:700', underline && 'text-decoration:underline'].filter(Boolean).join(';')
			return style ? '<span style="' + style + '">' + value + '</span>' : value
		}
		let html = '', offset = 0
		for (const match of code.matchAll(/\x1b\[([\d;]*)m/g)) {
			html += paint(code.slice(offset, match.index))
			for (const value of (match[1] || '0').split(';').map(Number)) {
				if (value === 0) { foreground = background = null; bold = underline = false }
				else if (value === 1) bold = true
				else if (value === 4) underline = true
				else if (value === 22) bold = false
				else if (value === 24) underline = false
				else if (value === 39) foreground = null
				else if (value === 49) background = null
				else if (value >= 30 && value <= 37) foreground = colors[value - 30]
				else if (value >= 40 && value <= 47) background = colors[value - 40]
				else if (value >= 90 && value <= 97) foreground = colors[value - 90]
			}
			offset = match.index + match[0].length
		}
		return html + paint(code.slice(offset))
	}
	if (language === 'fix') return span('string', code)
	if (language === 'diff') return code.split('\n').map(line => /^[+-]/.test(line) ? span(line[0] === '+' ? 'addition' : 'deletion', line) : line).join('\n')
	const aliases = { yml: 'yaml', js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash' }
	language = aliases[language] || language
	if (!['css', 'yaml', 'json', 'javascript', 'typescript', 'python', 'bash', 'ini', 'sql', 'html', 'xml'].includes(language)) return code
	// Tokenize once: generated markup must never be highlighted again.
	return code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?:&quot;|"|')[^\n]*?(?:&quot;|"|')|#(?:[a-fA-F0-9]{3,8}\b|[^\n]*)|&lt;\/?[\w-]+|[\w.-]+(?=\s*:)|\b(?:const|let|var|function|return|if|else|class|import|from|def|SELECT|FROM|WHERE|true|false|null|None)\b|\b\d+(?:\.\d+)?(?:px|em|rem|%)?/g, (token, offset) => {
		if (token.startsWith('/*') || token.startsWith('//') && ['javascript', 'typescript'].includes(language) || token[0] === '#' && ['yaml', 'python', 'bash', 'ini'].includes(language)) return span('comment', token)
		if (/^["']|^&quot;/.test(token)) return span('string', token)
		if (token[0] === '#' && language === 'css') return span('number', token)
		if (token[0] === '#') return token
		if (/^\d/.test(token)) return span('number', token)
		if (/^\s*:/.test(code.slice(offset + token.length))) return span('property', token)
		return span('keyword', token)
	})
}

function discordMarkdownToHtml(text) {
	if (!text) return ''

	// Сначала экранируем HTML
	let s = String(text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')

	// Protect code from all later Markdown substitutions.
	const codeBlocks = []
	const protect = html => '\u0000' + (codeBlocks.push(html) - 1) + '\u0000'
	s = s.replace(/```(?:([\w#+.-]+)\n)?([\s\S]*?)```/g, (_, language, code) => protect('<pre><code>' + discordCodeHighlight(code.replace(/^\n/, ''), language || '') + '</code></pre>'))
	s = s.replace(/`([^`\n]+)`/g, (_, code) => protect('<code>' + code + '</code>'))

	const heading = line => line.replace(/^(#{1,3}) (.+)$/, (_, marks, content) => '<h' + marks.length + '>' + content + '</h' + marks.length + '>')
		.replace(/^-# (.+)$/, '<small class="discord-subtext">$1</small>')

	// Bold ** ** or __ __ (underline is __ in Discord for underline, ** for bold)
	// Discord: **bold** *italic* __underline__ ~~strikethrough~~
	s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
	s = s.replace(/__(.+?)__/g, '<u>$1</u>')
	s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
	s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')
	s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="discord-spoiler" tabindex="0" role="button" aria-label="Показать спойлер" aria-expanded="false" onclick="this.classList.toggle(\'revealed\');this.setAttribute(\'aria-expanded\',this.classList.contains(\'revealed\'))" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}">$1</span>')

	// Simple URLs
	s = s.replace(
		/(https?:\/\/[^\s<]+)/g,
		url => `<a href="${url.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" target="_blank" rel="noopener">${url}</a>`
	)

	const lines = s.split('\n')
	const blocks = []
	for (let i = 0; i < lines.length; i++) {
		if (/^&gt; ?/.test(lines[i])) {
			const quote = []
			while (i < lines.length && /^&gt; ?/.test(lines[i])) quote.push(heading(lines[i++].replace(/^&gt; ?/, '')))
			i--
			blocks.push('<blockquote>' + quote.join('<br>') + '</blockquote>')
		} else if (/^- +/.test(lines[i])) {
			const items = []
			while (i < lines.length && /^- +/.test(lines[i])) items.push('<li>' + lines[i++].replace(/^- +/, '') + '</li>')
			i--
			blocks.push('<ul>' + items.join('') + '</ul>')
		} else blocks.push(heading(lines[i]))
	}
	return blocks.join('<br>').replace(/(<\/(?:h[1-3]|small|ul|blockquote)>)<br>/g, '$1')
		.replace(/\u0000(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)])
}
