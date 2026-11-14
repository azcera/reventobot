import { templateVariableName } from '../../../shared/templateVariables'
import { useEffect, useState } from 'react'
import { ArrowUpRight, Plus, Save, Trash2 } from 'lucide-react'
import type { Config, PageServices, Setter } from '../types'
import { ActionBar, Button, AutoTextarea, Field, IconButton, Panel } from '../components/ui'
import { syncNotice } from '../lib/templates'

export function TemplateVariables({ group, config, setConfig, api, run, notify, overview = false }: PageServices & { overview?: boolean; group: string; config: Config; setConfig: Setter<Config | null> }) {
	const savedEntries = () => Object.entries(config.templateVariables?.[group] || {}).map(([key, value]) => ({ key, value, label: config.templateVariableLabels?.[group]?.[key] || key }))
	const [entries, setEntries] = useState(savedEntries)
	const [validate, setValidate] = useState(false)
	useEffect(() => { setEntries(savedEntries()) }, [config.templateVariables, config.templateVariableLabels, group])
	function edit(index: number, column: 'key' | 'label' | 'value', value: string) { setEntries(previous => previous.map((entry, i) => i === index ? { ...entry, [column]: value } : entry)) }
	return <Panel title={`Переменные · ${group}`} action={overview && <IconButton icon={ArrowUpRight} label="Открыть переменные шаблона" onClick={() => { location.hash = `templates?group=${encodeURIComponent(group)}&section=variables` }} />}><div className="grid gap-4 p-5">
		<p className="field-hint">{overview ? 'Названия и значения переменных. Для изменения ключей открой шаблон по кнопке в заголовке.' : <>Название помогает найти переменную в панели. В тексте используй ключ в скобках, например {'{цена-пулик}'}. Допустимы буквы, цифры, дефисы и подчёркивания; первый символ — буква. Переменные работают и внутри секций. Системные ключи зарезервированы.</>}</p>
		{entries.map(({ key, label, value }, index) => <div key={index} className="flex items-start gap-2"><div className={`grid min-w-0 flex-1 items-start gap-3 ${overview ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}><Field label="Название переменной"><input className="h-12" value={label} maxLength={100} onChange={event => edit(index, 'label', event.target.value)} /></Field>{!overview && <Field label="Ключ" hint={validate && !templateVariableName.test(key) ? 'Ключ: до 64 букв, цифр, дефисов и подчёркиваний; начинается с буквы.' : validate && entries.filter(entry => entry.key === key).length > 1 ? 'Ключи должны быть уникальны.' : key ? `Вставка: {${key}}` : 'Без пробелов, например цена-пулик'}><input aria-invalid={validate && (!templateVariableName.test(key) || entries.filter(entry => entry.key === key).length > 1)} className="h-12" value={key} maxLength={64} onChange={event => edit(index, 'key', event.target.value)} /></Field>}<Field label="Значение"><AutoTextarea className="min-h-12" value={value} maxLength={4000} rows={1} onChange={event => edit(index, 'value', event.target.value)} /></Field></div><IconButton className="mt-6" icon={Trash2} label={`Удалить переменную ${label || key || index + 1}`} onClick={() => setEntries(entries.filter((_, i) => i !== index))} /></div>)}
		<ActionBar>{!overview && <IconButton label="Добавить переменную" icon={Plus} disabled={entries.length >= 50} onClick={() => setEntries([...entries, { key: '', label: '', value: '' }])} />}<IconButton label="Сохранить переменные" icon={Save} onClick={() => {
			setValidate(true)
			if (new Set(entries.map(entry => entry.key)).size !== entries.length) return
			if (entries.some(entry => !templateVariableName.test(entry.key))) return
			run(async () => { const next = await api('template-variables', { group, values: Object.fromEntries(entries.map(entry => [entry.key, entry.value])), labels: Object.fromEntries(entries.map(entry => [entry.key, entry.label.trim() || entry.key])), revision: config.revision }); setConfig(next); const notice = syncNotice(next, 'Переменные сохранены. Публикации обновлены.'); notify(notice.message, notice.error) })
		}} /></ActionBar>
	</div></Panel>
}

export function Variables({ config, setConfig, api, run, notify }: PageServices & { config: Config; setConfig: Setter<Config | null> }) {
	const [search, setSearch] = useState('')
	const [draft, setDraft] = useState(config.templateVariables || {})
	useEffect(() => { setDraft(config.templateVariables || {}) }, [config.templateVariables])
	const groups = [...new Set(config.templates.map(field => field.group))].filter(group => Object.keys(draft[group] || {}).length > 0)
	const query = search.trim().toLocaleLowerCase('ru')
	const matches = (group: string, key: string, value: string) => [group, config.templateVariableLabels?.[group]?.[key] || '', value].some(text => text.toLocaleLowerCase('ru').includes(query))
	const visible = groups.map(group => ({ group, entries: Object.entries(draft[group] || {}).filter(([key, value]) => matches(group, key, value)) })).filter(item => item.entries.length)
	return <div className="grid gap-5"><ActionBar><Button variant="primary" icon={Save} onClick={() => run(async () => {
		const next = await api('template-variables', { groups: draft, revision: config.revision })
		setConfig(next)
		const notice = syncNotice(next, 'Переменные сохранены. Публикации обновлены.'); notify(notice.message, notice.error)
	})}>Сохранить переменные</Button></ActionBar><Field label="Поиск переменных"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Шаблон, название или значение" /></Field>{visible.map(({ group, entries }) => <Panel key={group} title={`Переменные · ${group}`} action={<IconButton icon={ArrowUpRight} label="Открыть переменные шаблона" onClick={() => { location.hash = `templates?group=${encodeURIComponent(group)}&section=variables` }} />}><div className="grid gap-4 p-5">{entries.map(([key, value]) => <div key={key} className="grid gap-3"><Field label={`Значение · ${config.templateVariableLabels?.[group]?.[key] || key}`}><AutoTextarea className="min-h-12" rows={1} value={value} maxLength={4000} onChange={event => setDraft(previous => ({ ...previous, [group]: { ...previous[group], [key]: event.target.value } }))} /></Field></div>)}</div></Panel>)}{!visible.length && <p role="status" className="text-sm text-muted">{groups.length ? 'Переменные не найдены.' : 'Пока нет переменных. Добавь их на странице нужного шаблона.'}</p>}</div>
}
