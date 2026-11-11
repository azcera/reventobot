import type { ComponentItem } from '../shared/browserTypes'
// Shared by the browser editor and Discord payload builders.
	function url(value: string) {
		try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error(); return value }
		catch { throw new Error('Нужна прямая HTTP(S)-ссылка без логина и пароля.') }
	}
	function attrs(source: string, allowed: string[]) {
		const result: Record<string, string> = {}; let end = 0
		const pattern = /([a-zA-Z]+)\s*=\s*(["'])(.*?)\2/g
		for (const match of source.matchAll(pattern)) {
			if (source.slice(end, match.index).trim() || !allowed.includes(match[1]) || Object.hasOwn(result, match[1])) throw new Error('Проверьте атрибуты тега.')
			result[match[1]] = match[3].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); end = match.index + match[0].length
		}
		if (source.slice(end).trim()) throw new Error('Проверьте атрибуты тега.')
		return result
	}
	function parse(source: string): ComponentItem[] {
		const items: ComponentItem[] = []; let buffer: string[] = [], fence = false
		const flush = () => { if (buffer.join('\n').trim()) items.push({ type: 'text', value: buffer.join('\n').trim() }); buffer = [] }
		const lines = String(source).replace(/\r\n?/g, '\n').split('\n')
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i], trimmed = line.trim()
			if (/^```/.test(trimmed)) { fence = !fence; buffer.push(line); continue }
			if (fence) { buffer.push(line); continue }
			if (/^(\*\*\*|___|---)$/.test(trimmed)) { flush(); items.push({ type: 'separator', spacing: trimmed === '***' ? 'large' : 'small', divider: true }); continue }
			const image = /^<img\s+([\s\S]*?)\s*\/?\s*>$/.exec(trimmed)
			if (image) { flush(); const a = attrs(image[1], ['src']); items.push({ type: 'image', value: /^attachment:\/\/[a-zA-Z0-9_.-]+$/.test(a.src) ? a.src : url(a.src) }); continue }
			const separator = /^<separator\s+(.+?)\s*\/>$/.exec(trimmed)
			if (separator) { flush(); const a = attrs(separator[1], ['spacing', 'divider']); if (!['small', 'large'].includes(a.spacing) || !['true', 'false'].includes(a.divider)) throw new Error('Проверьте параметры разделителя.'); items.push({ type: 'separator', spacing: a.spacing as 'small' | 'large', divider: a.divider === 'true' }); continue }
			if (/^<section\b/.test(trimmed)) {
				flush(); let block = trimmed
				while (!block.includes('</section>') && i + 1 < lines.length) block += '\n' + lines[++i]
				const match = /^<section\s+([^>]+)>([\s\S]*?)<\/section>$/.exec(block)
				if (!match) throw new Error('Закройте секцию тегом </section>.')
				const a = attrs(match[1], ['buttonLabel', 'buttonLink'])
				if (!a.buttonLabel?.trim() || a.buttonLabel.length > 80 || !match[2].trim()) throw new Error('Заполните текст секции и подпись кнопки (до 80 символов).')
				const children = parse(match[2]); if (children.length !== 1 || children[0].type !== 'text') throw new Error('Внутри секции допускается только текст с Markdown.')
				items.push({ type: 'section', value: match[2].trim(), btnLabel: a.buttonLabel, btnLink: url(a.buttonLink) }); continue
			}
			if (/^<(img|section|separator)\b/.test(trimmed)) throw new Error('Проверьте синтаксис тега; размещайте его на отдельной строке.')
			buffer.push(line)
		}
		flush(); return items
	}
	const attribute = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	function stringify(items: ComponentItem[]) {
		return items.map(item => {
			if (item.type === 'image') return '<img src="' + attribute(item.value) + '" />'
			if (item.type === 'section') return '<section buttonLabel="' + attribute(item.btnLabel) + '" buttonLink="' + attribute(item.btnLink) + '">' + item.value + '</section>'
			if (item.type === 'separator') {
				const spacing = item.spacing || (item.large ? 'large' : 'small'), divider = item.divider ?? !item.large
				return divider ? (spacing === 'large' ? '***' : '---') : '<separator spacing="' + spacing + '" divider="' + divider + '" />'
			}
			return item.value
		}).join('\n\n')
	}
	const api = { parse, stringify }
export = api

