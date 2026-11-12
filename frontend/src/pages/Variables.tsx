import { templateVariableName } from '../../../shared/templateVariables'
import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import type { Config, PageServices, Setter } from '../types'
import { Button, Field, IconButton, Panel } from '../components/ui'
import { syncNotice } from '../lib/templates'

export function TemplateVariables({ group, config, setConfig, api, run, notify }: PageServices & { group: string; config: Config; setConfig: Setter<Config | null> }) {
	const savedEntries = () => Object.entries(config.templateVariables?.[group] || {}).map(([key, value]) => ({ key, value, label: config.templateVariableLabels?.[group]?.[key] || key }))
	const [entries, setEntries] = useState(savedEntries)
	useEffect(() => { setEntries(savedEntries()) }, [config.templateVariables, config.templateVariableLabels, group])
	function edit(index: number, column: 'key' | 'label' | 'value', value: string) { setEntries(previous => previous.map((entry, i) => i === index ? { ...entry, [column]: value } : entry)) }
	return <Panel title={`Переменные · ${group}`}><div className="grid gap-4 p-5">
		<p className="field-hint">Название помогает найти переменную в панели. В тексте используй ключ в скобках, например {'{цена-пулик}'}. Допустимы буквы, цифры, дефисы и подчёркивания; первый символ — буква. Переменные работают и внутри секций. Системные ключи зарезервированы.</p>
		{entries.map(({ key, label, value }, index) => <div key={index} className="flex items-end gap-2"><div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-3"><Field label={`Название переменной ${index + 1}`}><input value={label} maxLength={100} placeholder="Цена пулемёта" onChange={event => edit(index, 'label', event.target.value)} /></Field><Field label={`Ключ в тексте ${index + 1}`} hint={key ? `Вставка: {${key}}` : 'Без пробелов, например цена-пулик'}><input value={key} maxLength={64} placeholder="цена-пулик" onChange={event => edit(index, 'key', event.target.value)} /></Field><Field label={`Значение ${label || key || index + 1}`}><textarea value={value} maxLength={4000} rows={2} onChange={event => edit(index, 'value', event.target.value)} /></Field></div><IconButton icon={Trash2} label={`Удалить переменную ${label || key || index + 1}`} onClick={() => setEntries(entries.filter((_, i) => i !== index))} /></div>)}
		<div className="flex flex-wrap gap-2"><Button icon={Plus} disabled={entries.length >= 50} onClick={() => setEntries([...entries, { key: '', label: '', value: '' }])}>Добавить переменную</Button><Button icon={Save} onClick={() => {
			if (new Set(entries.map(entry => entry.key)).size !== entries.length) return notify('Ключи переменных должны быть уникальны.', true)
			if (entries.some(entry => !templateVariableName.test(entry.key))) return notify('Ключ должен начинаться с буквы и содержать до 64 букв, цифр, дефисов или подчёркиваний без пробелов.', true)
			run(async () => { const next = await api('template-variables', { group, values: Object.fromEntries(entries.map(entry => [entry.key, entry.value])), labels: Object.fromEntries(entries.map(entry => [entry.key, entry.label.trim() || entry.key])), revision: config.revision }); setConfig(next); const notice = syncNotice(next, 'Переменные сохранены. Публикации обновлены.'); notify(notice.message, notice.error) })
		}}>Сохранить переменные</Button></div>
	</div></Panel>
}

export function Variables(props: PageServices & { config: Config; setConfig: Setter<Config | null> }) {
	const [search, setSearch] = useState('')
	const groups = [...new Set(props.config.templates.map(field => field.group))].filter(group => Object.keys(props.config.templateVariables?.[group] || {}).length > 0)
	const visibleGroups = groups.filter(group => [group, ...Object.entries(props.config.templateVariables?.[group] || {}).flat(), ...Object.values(props.config.templateVariableLabels?.[group] || {})].join(' ').toLowerCase().includes(search.toLowerCase()))
	return <div className="grid gap-5"><Field label="Поиск переменных"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Шаблон, название, ключ или значение" /></Field>{visibleGroups.map(group => <TemplateVariables key={group} {...props} group={group} />)}{!visibleGroups.length && <p role="status" className="text-sm text-muted">{groups.length ? 'Переменные не найдены.' : 'Пока нет переменных. Добавь их на странице нужного шаблона.'}</p>}</div>
}
