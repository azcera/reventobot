// One source document, retaining the existing template keys for bot commands.
;(function (root) {
	const marker = key => '<!-- template:' + key + ' -->'
	function stringify(fields, values) {
		if (fields.length === 1) return values[fields[0].key] ?? fields[0].value
		return fields.map(field => marker(field.key) + '\n' + (values[field.key] ?? field.value)).join('\n\n')
	}
	function parse(source, fields) {
		if (fields.length === 1) return { [fields[0].key]: source }
		const allowed = new Set(fields.map(field => field.key))
		const result = {}; let current, start = 0, offset = 0
		for (const line of source.split('\n')) {
			// Some existing templates deliberately open and close code fences in different fields.
			const match = /^<!-- template:([^\s]+) -->$/.exec(line)
			if (match) {
				if (!allowed.has(match[1]) || Object.hasOwn(result, match[1]) || current === match[1]) throw new Error('Неизвестная или повторная метка шаблона: ' + match[1])
				if (current) result[current] = source.slice(start, offset).replace(/\n\n$/, '')
				else if (source.slice(0, offset).trim()) throw new Error('Текст должен находиться после метки шаблона.')
				current = match[1]; start = offset + line.length + 1
			}
			offset += line.length + 1
		}
		if (current) result[current] = source.slice(start)
		if (Object.keys(result).length !== fields.length) throw new Error('Сохраните метки <!-- template:… -->: они связывают документ с сообщениями и кнопками бота.')
		return result
	}
	const api = { stringify, parse }
	if (typeof module !== 'undefined') module.exports = api
	else root.templateDocument = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
