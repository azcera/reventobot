export function queryAt(value, start, end = start) {
	if (start !== end) return null
	const before = value.slice(0, start)
	if (before.replace(/```[\s\S]*?```|`[^`\n]*`/g, '').includes('`')) return null
	const match = /(?:^|[\s(])([@#])([^\s@#<>`]*)$/.exec(before)
	if (!match || match[1] === '#' && /^\s*#$/.test(before.slice(before.lastIndexOf('\n') + 1))) return null
	return { kind: match[1], text: match[2], start: start - match[2].length - 1, end: start }
}

export function suggestions(query, resources) {
	if (!query) return []
	const list = query.kind === '@' ? resources.roles : resources.channels.filter(channel => channel.type !== 4)
	const search = query.text.toLowerCase()
	return list.filter(item => item.name.toLowerCase().includes(search) || item.id.includes(search)).slice(0, 20)
}
