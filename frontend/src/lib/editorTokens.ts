export interface EditorToken { start: number; end: number; source: string; kind: 'image' | 'section' | 'link'; label: string }

export function editorTokens(value: string, components = true): EditorToken[] {
	const tokens: EditorToken[] = []
	const pattern = /```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]*`|<section\s+[^>]*>[\s\S]*?<\/section>|<img\s+[^>]*\/?\s*>|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
	for (const match of value.matchAll(pattern)) {
		const source = match[0], start = match.index!
		if (source.startsWith('`')) continue
		const kind = source.startsWith('<img') ? 'image' : source.startsWith('<section') ? 'section' : 'link'
		if (!components && kind !== 'link') continue
		tokens.push({ start, end: start + source.length, source, kind, label: kind === 'image' ? 'Изображение' : kind === 'section' ? 'Секция: ' + source.replace(/^<section[^>]*>/, '').replace(/<\/section>$/, '').trim().slice(0, 50) : 'Ссылка: ' + match[1] })
	}
	return tokens
}
