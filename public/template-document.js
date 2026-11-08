// One source document, retaining the existing template keys for bot commands.
;(function (root) {
	const heading = field => '###### ' + (field.label || field.key).replace(/^#+\s+/, '').replace(/\r?\n/g, ' ')
	function stringify(fields, values) {
		if (fields.length === 1) return values[fields[0].key] ?? fields[0].value
		return fields.map(field => heading(field) + '\n\n' + (values[field.key] ?? field.value)).join('\n\n')
	}
	function parse(source, fields) {
		if (fields.length === 1) return { [fields[0].key]: source }
		const sections = new Map(fields.map(field => [heading(field), field.key]))
		if (sections.size !== fields.length) throw new Error('Названия разделов шаблона должны быть уникальными.')
		const result = {}; let current, start = 0, offset = 0
		for (const line of source.split('\n')) {
			// Some existing templates deliberately open and close code fences in different fields.
			const key = sections.get(line.replace(/\r$/, ''))
			if (key) {
				if (Object.hasOwn(result, key) || current === key) throw new Error('Повторный раздел шаблона: ' + line)
				if (current) result[current] = source.slice(start, offset).replace(/\n\n$/, '')
				else if (source.slice(0, offset).trim()) throw new Error('Текст должен находиться под заголовком раздела.')
				current = key; start = offset + line.length + 1
				// The blank line after a Markdown heading belongs to the document structure.
				if (source.slice(start, start + 2) === '\r\n') start += 2
				else if (source[start] === '\n') start++
			}
			offset += line.length + 1
		}
		if (current) result[current] = source.slice(start)
		if (Object.keys(result).length !== fields.length) throw new Error('Сохраните заголовки разделов (###### Название): под ними редактируются сообщения и кнопки бота.')
		return result
	}
	const api = { stringify, parse }
	if (typeof module !== 'undefined') module.exports = api
	else root.templateDocument = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
