import React from 'react'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button, Field, IconButton, Panel, useModal } from '../components/ui.jsx'

function MoveActions({ index, length, onMove, onRemove }) {
	return <div className="flex shrink-0 gap-1"><IconButton icon={ArrowUp} label="Повысить приоритет" disabled={index === 0} onClick={() => onMove(-1)} /><IconButton icon={ArrowDown} label="Понизить приоритет" disabled={index === length - 1} onClick={() => onMove(1)} /><IconButton icon={Trash2} label="Удалить из настройки" onClick={onRemove} /></div>
}

function OrderedChoices({ field, value, onChange, resources }) {
	const multiple = ['roles', 'channels'].includes(field.type)
	const items = field.type.startsWith('role') ? resources.roles : resources.channels.filter(channel => field.channelTypes.includes(channel.type))
	const selected = String(value ?? '').split(',').map(id => id.trim()).filter(Boolean)
	const prefix = field.type.startsWith('role') ? '@ ' : '# '
	return <div className="grid gap-3"><Field label={field.label}><select value={multiple ? '' : value} onChange={event => {
		if (!multiple) return onChange(event.target.value)
		if (event.target.value && !selected.includes(event.target.value)) onChange([...selected, event.target.value].join(','))
	}}><option value="">{multiple ? 'Добавить…' : 'Не выбран'}</option>{!multiple && value && !items.some(item => item.id === value) && <option value={value}>Недоступен: {value}</option>}{items.filter(item => !multiple || !selected.includes(item.id)).map(item => <option key={item.id} value={item.id}>{prefix}{item.name}</option>)}</select></Field>
		{multiple && selected.map((id, index) => <div className="ordered-row" key={id}><span className="min-w-0 flex-1 break-words text-sm"><span className="mr-2 text-muted">{index + 1}.</span>{prefix}{items.find(item => item.id === id)?.name || 'Недоступен · ' + id}</span><MoveActions index={index} length={selected.length} onMove={direction => { const next = [...selected]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next.join(',')) }} onRemove={() => onChange(selected.filter(value => value !== id).join(','))} /></div>)}
	</div>
}

function RolePrefixes({ field, value, onChange, resources, onSync }) {
	return <div className="grid gap-4"><div><h3 className="field-label">{field.label}</h3><p className="field-hint mt-2">Формат [Dep]. Приоритет сверху вниз. Пробел после префикса добавляется автоматически.</p></div>
		{value.map((entry, index) => <div className="prefix-row" key={index}><div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_110px]"><select aria-label={`Роль для префикса ${index + 1}`} value={entry.roleId} onChange={event => onChange(value.map((item, i) => i === index ? { ...item, roleId: event.target.value } : item))}><option value="">Выбери роль</option>{entry.roleId && !resources.roles.some(role => role.id === entry.roleId) && <option value={entry.roleId}>Удалённая роль · {entry.roleId}</option>}{resources.roles.map(role => <option key={role.id} value={role.id}>@ {role.name}</option>)}</select><input aria-label={`Префикс ${index + 1}`} placeholder="[Dep]" value={entry.prefix} maxLength={24} onChange={event => onChange(value.map((item, i) => i === index ? { ...item, prefix: event.target.value } : item))} /></div><MoveActions index={index} length={value.length} onMove={direction => { const next = [...value]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next) }} onRemove={() => onChange(value.filter((_, i) => i !== index))} /></div>)}
		<div className="flex flex-wrap gap-2"><IconButton icon={Plus} label="Добавить префикс" onClick={() => onChange([...value, { roleId: '', prefix: '' }])} /><Button icon={RefreshCw} onClick={onSync}>Сохранить префиксы и обновить ники</Button></div><p className="field-hint">Обновятся участники с указанными ролями. Недоступные участники и ники длиннее 32 символов будут пропущены.</p>
	</div>
}

export function Settings({ config, setConfig, resources, draft, setDraft, api, run, notify }) {
	const modal = useModal()
	const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }))
	function save(event) {
		event.preventDefault()
		const values = Object.fromEntries(config.settings.filter(field => JSON.stringify(field.value) !== JSON.stringify(draft[field.key])).map(field => [field.key, draft[field.key]]))
		if (!Object.keys(values).length) return notify('Нет изменений для сохранения.')
		run(async () => { setConfig(await api('settings', { revision: config.revision, values })); notify('Настройки сохранены и применены.') })
	}
	async function syncPrefixes(field) {
		if (!await modal({ title: 'Сохранить префиксы и обновить ники?', message: 'Бот сохранит список и обновит ники участников с указанными ролями. Остальные несохранённые настройки не применятся.', confirm: 'Обновить ники' })) return
		run(async () => {
			setConfig(await api('settings', { revision: config.revision, values: { [field.key]: draft[field.key] } }))
			notify('Префиксы сохранены. Обновляются участники…')
			try {
				const result = await api('role-prefixes/sync', {})
				notify(`Обновлено: ${result.updated}. Уже актуальны: ${result.unchanged}. Пропущено: ${result.skipped}. Ошибок: ${result.failed}.`, result.failed > 0 || result.skipped > 0)
			} catch (error) { throw new Error('Префиксы сохранены, но обновление участников не завершено: ' + error.message) }
		})
	}
	const categories = [
		['Каналы', config.settings.filter(field => ['channel', 'channels'].includes(field.type))],
		['Роли и приоритеты', config.settings.filter(field => ['role', 'roles'].includes(field.type))],
		['Префиксы участников', config.settings.filter(field => field.type === 'rolePrefixes')],
		['Поведение бота', config.settings.filter(field => !['channel', 'channels', 'role', 'roles', 'rolePrefixes'].includes(field.type))]
	]
	return <form className="grid gap-6" onSubmit={save} noValidate>{categories.filter(([, fields]) => fields.length).map(([title, fields]) => <Panel key={title} title={title}><div className={`grid gap-6 p-5 sm:p-6 ${title === 'Каналы' ? 'lg:grid-cols-2' : ''}`}>
		{fields.map(field => field.type === 'rolePrefixes' ? <RolePrefixes key={field.key} field={field} value={draft[field.key]} onChange={value => set(field.key, value)} resources={resources} onSync={() => syncPrefixes(field)} />
			: field.type === 'boolean' ? <label key={field.key} className="toggle-row"><span className="text-sm">{field.label}</span><input type="checkbox" role="switch" checked={Boolean(draft[field.key])} onChange={event => set(field.key, event.target.checked)} /><span className="toggle-track" aria-hidden="true" /></label>
				: field.type === 'color' ? <Field key={field.key} label={field.label}><input type="color" value={draft[field.key]} onChange={event => set(field.key, event.target.value)} /></Field>
					: <OrderedChoices key={field.key} field={field} value={draft[field.key]} onChange={value => set(field.key, value)} resources={resources} />)}
	</div></Panel>)}<div className="flex flex-wrap items-center justify-between gap-4"><p className="text-xs text-muted">Настройки применяются без перезапуска бота</p><Button type="submit" variant="primary" icon={Save}>Сохранить настройки</Button></div></form>
}
