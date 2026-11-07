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
		url => `<a href="${url.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" target="_blank" rel="noopener">${url}</a>`
	)

	// Newlines → <br> but not inside pre
	// Split by pre blocks
	const parts = s.split(/(<pre>[\s\S]*?<\/pre>)/)
	s = parts
		.map(part => {
			if (part.startsWith('<pre>')) return part
			return part.replace(/(<\/h[1-3]>)\n/g, '$1').replace(/\n/g, '<br>')
		})
		.join('')

	return s
}
