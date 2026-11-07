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

	// Protect code from all later Markdown substitutions.
	const codeBlocks = []
	const protect = html => '\u0000' + (codeBlocks.push(html) - 1) + '\u0000'
	s = s.replace(/```(?:[a-zA-Z]+\n)?([\s\S]*?)```/g, (_, code) => protect('<pre><code>' + code.replace(/^\n/, '') + '</code></pre>'))
	s = s.replace(/`([^`\n]+)`/g, (_, code) => protect('<code>' + code + '</code>'))

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
		url => `<a href="${url.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" target="_blank" rel="noopener">${url}</a>`
	)

	const lines = s.split('\n')
	const blocks = []
	for (let i = 0; i < lines.length; i++) {
		if (/^&gt; ?/.test(lines[i])) {
			const quote = []
			while (i < lines.length && /^&gt; ?/.test(lines[i])) quote.push(lines[i++].replace(/^&gt; ?/, ''))
			i--
			blocks.push('<blockquote>' + quote.join('<br>') + '</blockquote>')
		} else if (/^- +/.test(lines[i])) {
			const items = []
			while (i < lines.length && /^- +/.test(lines[i])) items.push('<li>' + lines[i++].replace(/^- +/, '') + '</li>')
			i--
			blocks.push('<ul>' + items.join('') + '</ul>')
		} else blocks.push(lines[i])
	}
	return blocks.join('<br>').replace(/(<\/(?:h[1-3]|ul|blockquote)>)<br>/g, '$1')
		.replace(/\u0000(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)])
}
