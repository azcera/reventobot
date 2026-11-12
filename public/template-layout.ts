import type { TemplateField } from '../shared/browserTypes'
// Markdown documents assembled from the existing fields, including saved overrides.
	function documents(fields: TemplateField[]) {
		const result: TemplateField[] = []
		const get = (key: string) => fields.find(field => field.key === key)?.value ?? ''
		const add = (key: string, group: string, label: string, value: string) => result.push({ key, group, label, type: 'text', components: true, maxLength: 4000, value, default: value, variables: [...new Set([...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]))] })
		const join = (parts: string[]) => parts.filter(Boolean).join('\n\n---\n\n')
		const image = (key: string) => get(key) && !get(key).startsWith('attachment://') ? '<img src="' + get(key) + '" />' : ''
		add('announcement.document', 'Объявление капта', 'Текст объявления капта', join([get('announcement.banner'), get('announcement.title'), [get('announcement.details'), get('announcement.mention')].filter(Boolean).join('\n')]))
		add('rules.document', 'Правила', 'Правила целиком', join([image('rules.1'), ...fields.filter(field => /^rules\.(heading|rule)\./.test(field.key)).sort((a, b) => { const position = (key: string) => { const parts = key.split('.'); return Number(parts[2]) * 1000 + (parts[1] === 'heading' ? 0 : Number(parts[3])) }; return position(a.key) - position(b.key) }).map(field => field.value)]))
		add('invite.document', 'Приглашение', 'Текст приглашения', [image('invite.1'), ...[5, 6, 7, 8, 9, 10].map(n => get('invite.' + n)), image('invite.2'), get('invite.11'), ...fields.filter(field => field.key.startsWith('invite.form.')).map(field => field.value), ...[12, 13, 14].map(n => get('invite.' + n))].filter(Boolean).join('\n\n***\n\n'))
		const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		add('navigation.document', 'Навигация', 'Текст навигации', join([get('navigation.1'), ...Array.from({ length: 9 }, (_, i) => get('navigation.item.' + i + '.link') ? '<section buttonLabel="' + attr(get('navigation.item.' + i + '.label')) + '" buttonLink="' + attr(get('navigation.item.' + i + '.link')) + '">' + get('navigation.item.' + i + '.text') + '</section>' : '## ' + get('navigation.item.' + i + '.label'))]))
		for (const [state, label] of Object.entries({ pending: 'На рассмотрении', accepted: 'Принята', rejected: 'Отклонена', interview: 'Обзвон' })) {
			add('application.document.' + state, 'Заявка', label, join([state === 'pending' ? get('application.title') + get('application.help') : get('application.' + state), get('application.details'), get('application.' + state + 'Status')]))
		}
		for (const [state, label, keys] of [['accepted', 'Принята', ['acceptTitle', 'acceptDate']], ['rejected', 'Отклонена', ['rejectTitle', 'rejectReason']], ['interview', 'Обзвон', ['interviewTitle', 'interviewDate']]] as [string, string, string[]][]) add('dm.document.' + state, 'Личные сообщения заявок', label, join(keys.map(key => get('dm.' + key))))
		return result
	}
	const api = { documents }
export = api
