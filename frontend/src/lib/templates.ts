import type { Config, Drafts, TemplateField, PreviewField, ComponentParser } from '../types'
export const permanentGroups: Record<string, string> = { rules: 'Правила', invite: 'Приглашение', promotion: 'Система повышения', recruit: 'Памятка рекрута' }
export const examples: Record<string, string> = { icon: '⚔️', title: 'АТАКА', target: 'АТАКУ', enemy: '`Rivals`', emoji: '📍', event: 'Дроп', relative: 'через 10 минут', tomorrow: '', days: ' · пн, вт', note: '', warning: '', result: '`Ожидается`', resultIcon: '❔', registration: '', damage: 'Tony — **100**', kills: 'Tony — **2**', confirmedCount: '1', confirmedPlayers: '1. @Tony', waitingCount: '2', waitingPlayers: '1. @Alex\n2. @Sam', leftCount: '0', leftPlayers: 'Пусто', page: '1', pages: '1', map: 'Лес', zone: 'A1', status: 'active', mode: 'по роли и времени записи', registrationStatus: 'Время и состав обновляются автоматически.', freshness: '', user: '123456789012345678', name: 'Tony | 132961', age: '18', about: 'Хочу развиваться вместе с семьёй', history: 'Revento', admin: '987654321098765432', server: 'REVENTO', channel: '123456789012345678', time: '18:00 МСК', count: '3', limit: '20', players: '1. @Tony\n2. @Alex\n3. @Sam', reason: 'Ошибка в анкете', part: '2' }
export const replaceExamples = (value: unknown) => String(value ?? '').replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => examples[name] ?? match)

export function editorFields(config: Config, group: string): TemplateField[] {
	const fields = config.templates.filter(field => field.group === group)
	if (group === 'Правила') return [fields.find(field => field.key === 'rules.document') || {
		key: 'rules.document', group, type: 'text', label: 'Правила целиком', components: true,
		value: fields.filter(field => /^rules\.(heading|rule)\./.test(field.key)).map(field => field.value).join('\n\n---\n\n'), variables: []
	}]
	const order = group === 'Приглашение' ? ['invite.document', 'invite.3', 'invite.4'] : group === 'Регистрация на капт' ? ['capture.document', 'capture.2', 'capture.3', 'capture.sortTime', 'capture.sortPriority'] : []
	return fields.sort((a, b) => order.length ? order.indexOf(a.key) - order.indexOf(b.key) : Number(b.key.includes('.document')) - Number(a.key.includes('.document')))
}

export const fieldValues = (fields: TemplateField[]) => Object.fromEntries(fields.map(field => [field.key, field.value]))
export const changedValues = (fields: TemplateField[], values: Record<string, string>) => Object.fromEntries(fields.filter(field => values[field.key] !== undefined && values[field.key] !== field.value).map(field => [field.key, values[field.key]]))
export const dirtyGroup = (config: Config, drafts: Drafts, group: string) => Object.keys(changedValues(editorFields(config, group), drafts[group] || {})).length > 0

export function previewFields(config: Config, group: string, fields: TemplateField[], values: Record<string, string>, parser: ComponentParser) {
	let result: PreviewField[] = fields.map(field => ({ ...field, value: values[field.key] ?? field.value }))
	if (group === 'Приглашение') return result.filter(field => field.key === 'invite.document')
	if (group === 'Регистрация на капт') {
		result = ['document', '2', '3', 'sortTime'].map(key => result.find(field => field.key === 'capture.' + key)).filter((field): field is PreviewField => Boolean(field))
	}
	if (group === 'Обычная регистрация') result = ['document', 'sortTime', 'join', 'leave', 'editTime'].map(key => result.find(field => field.key === 'registration.' + key)).filter((field): field is PreviewField => Boolean(field))
	return result
}

export function syncNotice(config: Config, success: string) {
	const failures = (config.syncResults || []).filter(result => !result.ok)
	const logErrors = (config.syncResults || []).filter(result => result.logError)
	return failures.length ? { error: true, message: 'Шаблон сохранён, но обновление в Discord не завершено: ' + failures.map(result => (permanentGroups[result.kind] || config.bindings[result.kind]?.fields?.[0]?.group || 'Навигация') + ': ' + result.error).join('\n') + '\nПовтори обновление после устранения причины.' }
		: logErrors.length ? { error: true, message: success + '\n' + logErrors.map(result => result.logError).join('\n') }
			: { message: success }
}
