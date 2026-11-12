import { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import type { Config, PageServices, Setter } from '../types'
import { Button, Field, IconButton, Panel } from '../components/ui'
import { syncNotice } from '../lib/templates'

export function TemplateVariables({ group, config, setConfig, api, run, notify }: PageServices & { group: string; config: Config; setConfig: Setter<Config | null> }) {
	const saved = config.templateVariables?.[group] || {}
	const [entries, setEntries] = useState(() => Object.entries(saved))
	useEffect(() => { setEntries(Object.entries(config.templateVariables?.[group] || {})) }, [config.templateVariables, group])
	function edit(index: number, column: number, value: string) { setEntries(previous => previous.map((entry, i) => i === index ? entry.map((part, j) => j === column ? value : part) as [string, string] : entry)) }
	return <Panel title={`Переменные · ${group}`}><div className="grid gap-4 p-5">
		<p className="field-hint">Сохрани переменную и вставь её в текст как {'{имя}'}. Значения действуют внутри этого шаблона. Системные переменные изменить нельзя.</p>
		{entries.map(([name, value], index) => <div key={index} className="flex items-end gap-2"><div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"><Field label={`Имя переменной ${index + 1}`}><input value={name} maxLength={64} onChange={event => edit(index, 0, event.target.value)} /></Field><Field label={`Значение ${name || index + 1}`}><textarea value={value} maxLength={4000} rows={2} onChange={event => edit(index, 1, event.target.value)} /></Field></div><IconButton icon={Trash2} label={`Удалить переменную ${name || index + 1}`} onClick={() => setEntries(entries.filter((_, i) => i !== index))} /></div>)}
		<div className="flex flex-wrap gap-2"><Button icon={Plus} disabled={entries.length >= 50} onClick={() => setEntries([...entries, ['', '']])}>Добавить переменную</Button><Button icon={Save} onClick={() => {
			if (new Set(entries.map(([name]) => name)).size !== entries.length) return notify('Имена переменных должны быть уникальны.', true)
			run(async () => { const next = await api('template-variables', { group, values: Object.fromEntries(entries), revision: config.revision }); setConfig(next); const notice = syncNotice(next, 'Переменные сохранены. Публикации обновлены.'); notify(notice.message, notice.error) })
		}}>Сохранить переменные</Button></div>
	</div></Panel>
}

export function Variables(props: PageServices & { config: Config; setConfig: Setter<Config | null> }) {
	const [search, setSearch] = useState('')
	const groups = [...new Set(props.config.templates.map(field => field.group))]
	return <div className="grid gap-5"><Field label="Поиск переменных"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Шаблон, имя или значение" /></Field>{groups.filter(group => [group, ...Object.entries(props.config.templateVariables?.[group] || {}).flat()].join(' ').toLowerCase().includes(search.toLowerCase())).map(group => <TemplateVariables key={group} {...props} group={group} />)}</div>
}
