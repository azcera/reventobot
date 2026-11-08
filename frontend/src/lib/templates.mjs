export const permanentGroups = { rules: 'Правила', invite: 'Приглашение', promotion: 'Система повышения', recruit: 'Памятка рекрута' }
export const examples = { confirmedCount: '1', confirmedPlayers: '1. @Tony', waitingCount: '2', waitingPlayers: '1. @Alex\n2. @Sam', leftCount: '0', leftPlayers: 'Пусто', page: '1', pages: '1', map: 'Лес', zone: 'A1', status: 'active', mode: 'по роли и времени записи', registrationStatus: 'Время и состав обновляются автоматически.', freshness: '', user: '123456789012345678', name: 'Tony | 132961', age: '18', about: 'Хочу развиваться вместе с семьёй', history: 'Revento', admin: '987654321098765432', server: 'REVENTO', channel: '123456789012345678', time: '18:00 МСК', target: 'капт', count: '3', limit: '20', players: '1. @Tony\n2. @Alex\n3. @Sam', reason: 'Ошибка в анкете', part: '2' }
export const replaceExamples = value => String(value ?? '').replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => examples[name] ?? match)

export function editorFields(config, group) {
	const fields = config.templates.filter(field => field.group === group)
	if (group === 'Правила') return [fields.find(field => field.key === 'rules.document') || {
		key: 'rules.document', type: 'text', label: 'Правила целиком', components: true,
		value: fields.filter(field => /^rules\.(heading|rule)\./.test(field.key)).map(field => field.value).join('\n\n---\n\n'), variables: []
	}]
	const order = group === 'Приглашение' ? ['invite.document', 'invite.3', 'invite.4'] : group === 'Регистрация на капт' ? ['capture.title', 'capture.time', 'capture.info', 'capture.sort', 'capture.confirmed', 'capture.waiting', 'capture.2', 'capture.3', 'capture.sortTime', 'capture.sortPriority'] : []
	return fields.sort((a, b) => order.length ? order.indexOf(a.key) - order.indexOf(b.key) : Number(b.key.includes('.document')) - Number(a.key.includes('.document')))
}

export const fieldValues = fields => Object.fromEntries(fields.map(field => [field.key, field.value]))
export const changedValues = (fields, values) => Object.fromEntries(fields.filter(field => values[field.key] !== undefined && values[field.key] !== field.value).map(field => [field.key, values[field.key]]))
export const dirtyGroup = (config, drafts, group) => Object.keys(changedValues(editorFields(config, group), drafts[group] || {})).length > 0

export function previewFields(config, group, fields, values, parser) {
	let result = fields.map(field => ({ ...field, value: values[field.key] ?? field.value }))
	if (group === 'Правила' && !result.some(field => parser.parse(field.value).some(item => item.type === 'image'))) {
		result = [{ type: 'text', value: parser.stringify([{ type: 'image', value: config.templates.find(field => field.key === 'rules.1')?.value ?? 'attachment://rules.png' }, { type: 'separator', divider: true }]) }, ...result]
	}
	if (group === 'Приглашение') return result.filter(field => field.key === 'invite.document')
	if (group === 'Регистрация на капт') {
		const text = key => result.find(field => field.key === 'capture.' + key)?.value ?? ''
		result = [{ type: 'text', value: [text('title') + '\n\n' + text('time') + '\n\n' + text('info'), text('sort') + '\n\n' + text('confirmed'), text('waiting')].join('\n\n---\n\n') }, ...['2', '3', 'sortTime'].map(key => result.find(field => field.key === 'capture.' + key)).filter(Boolean)]
	}
	if (group === 'Обычная регистрация') result = ['document', 'sortTime', 'join', 'leave', 'editTime'].map(key => result.find(field => field.key === 'registration.' + key)).filter(Boolean)
	return result
}

export function syncNotice(config, success) {
	const failures = (config.syncResults || []).filter(result => !result.ok)
	const logErrors = (config.syncResults || []).filter(result => result.logError)
	return failures.length ? { error: true, message: 'Шаблон сохранён, но обновление в Discord не завершено: ' + failures.map(result => (permanentGroups[result.kind] || 'Навигация') + ': ' + result.error).join('\n') + '\nПовтори обновление после устранения причины.' }
		: logErrors.length ? { error: true, message: success + '\n' + logErrors.map(result => result.logError).join('\n') }
			: { message: success }
}
