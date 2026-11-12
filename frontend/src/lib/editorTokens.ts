export interface EditorToken { start: number; end: number; source: string; kind: 'image' | 'section' | 'link'; label: string }
interface MentionToken { start: number; end: number; source: string; kind: 'mention'; label: string }

export function editorTokens(value: string, components = true, resources: { channels: { id: string; name: string }[]; roles: { id: string; name: string }[] } = { channels: [], roles: [] }): (EditorToken | MentionToken)[] {
	const tokens: (EditorToken | MentionToken)[] = []
	const pattern = /```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]*`|<section\s+[^>]*>[\s\S]*?<\/section>|<img\s+[^>]*\/?\s*>|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<(@&|#)(\d{17,20})>/g
	for (const match of value.matchAll(pattern)) {
		const source = match[0], start = match.index!
		if (source.startsWith('`')) continue
		if (match[3]) {
			const role = match[3] === '@&', id = match[4]
			const name = resources[role ? 'roles' : 'channels'].find(item => item.id === id)?.name || id
			tokens.push({ start, end: start + source.length, source, kind: 'mention', label: (role ? '@' : '#') + name })
			continue
		}
		const kind = source.startsWith('<img') ? 'image' : source.startsWith('<section') ? 'section' : 'link'
		if (!components && kind !== 'link') continue
		tokens.push({ start, end: start + source.length, source, kind, label: kind === 'image' ? 'Изображение' : kind === 'section' ? 'Секция: ' + source.replace(/^<section[^>]*>/, '').replace(/<\/section>$/, '').trim().slice(0, 50) : 'Ссылка: ' + match[1] })
	}
	return tokens
}
