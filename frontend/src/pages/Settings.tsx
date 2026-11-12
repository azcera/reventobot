import type { Config, Resources, SettingField, SettingValue, SettingsDraft, RolePrefix, Setter, PageServices } from '../types'
import { errorMessage } from '../types'
import React, { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button, Field, IconButton, Panel, useModal } from '../components/ui'

function MoveActions({ index, length, onMove, onRemove }: { index: number; length: number; onMove(direction: number): void; onRemove(): void }) {
	return <div className="flex shrink-0 gap-1"><IconButton icon={ArrowUp} label="Повысить приоритет" disabled={index === 0} onClick={() => onMove(-1)} /><IconButton icon={ArrowDown} label="Понизить приоритет" disabled={index === length - 1} onClick={() => onMove(1)} /><IconButton icon={Trash2} label="Удалить из настройки" onClick={onRemove} /></div>
}

function OrderedChoices({ field, value, onChange, resources, hiddenRoles = [] }: { field: SettingField; value: SettingValue; onChange(value: string): void; resources: Resources; hiddenRoles?: string[] }) {
	const multiple = ['roles', 'channels'].includes(field.type)
	const items = field.type.startsWith('role') ? resources.roles.filter(role => !hiddenRoles.includes(role.id)) : resources.channels.filter(channel => field.channelTypes?.includes(channel.type))
	const selected = String(value ?? '').split(',').map(id => id.trim()).filter(Boolean)
	const prefix = field.type.startsWith('role') ? '@ ' : '# '
	return <div className="grid gap-3"><Field label={field.label}><select value={multiple ? '' : String(value ?? '')} onChange={event => {
		if (!multiple) return onChange(event.target.value)
		if (event.target.value && !selected.includes(event.target.value)) onChange([...selected, event.target.value].join(','))
	}}><option value="">{multiple ? 'Добавить…' : 'Не выбран'}</option>{!multiple && value && !items.some(item => item.id === value) && <option value={String(value)}>Недоступен: {String(value)}</option>}{items.filter(item => !multiple || !selected.includes(item.id)).map(item => <option key={item.id} value={item.id}>{prefix}{item.name}</option>)}</select></Field>
		{multiple && selected.map((id, index) => !hiddenRoles.includes(id) && <div className="ordered-row" key={id}><span className="min-w-0 flex-1 break-words text-sm"><span className="mr-2 text-muted">{index + 1}.</span>{prefix}{items.find(item => item.id === id)?.name || 'Недоступен · ' + id}</span><MoveActions index={index} length={selected.length} onMove={direction => { const next = [...selected]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next.join(',')) }} onRemove={() => onChange(selected.filter(value => value !== id).join(','))} /></div>)}
	</div>
}

function RolePrefixes({ field, value, onChange, resources, onSync }: { field: SettingField; value: RolePrefix[]; onChange(value: RolePrefix[]): void; resources: Resources; onSync(): void }) {
	return <div className="grid gap-4"><div><h3 className="field-label">{field.label}</h3><p className="field-hint mt-2">Формат [Dep]. Приоритет сверху вниз. Пробел после префикса добавляется автоматически.</p></div>
		{value.map((entry, index) => <div className="prefix-row" key={index}><div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_110px]"><select aria-label={`Роль для префикса ${index + 1}`} value={entry.roleId} onChange={event => onChange(value.map((item, i) => i === index ? { ...item, roleId: event.target.value } : item))}><option value="">Выбери роль</option>{entry.roleId && !resources.roles.some(role => role.id === entry.roleId) && <option value={entry.roleId}>Удалённая роль · {entry.roleId}</option>}{resources.roles.map(role => <option key={role.id} value={role.id}>@ {role.name}</option>)}</select><input aria-label={`Префикс ${index + 1}`} placeholder="[Dep]" value={entry.prefix} maxLength={24} onChange={event => onChange(value.map((item, i) => i === index ? { ...item, prefix: event.target.value } : item))} /></div><MoveActions index={index} length={value.length} onMove={direction => { const next = [...value]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next) }} onRemove={() => onChange(value.filter((_, i) => i !== index))} /></div>)}
		<div className="flex flex-wrap gap-2"><IconButton icon={Plus} label="Добавить префикс" onClick={() => onChange([...value, { roleId: '', prefix: '' }])} /><Button icon={RefreshCw} onClick={onSync}>Сохранить префиксы и обновить ники</Button></div><p className="field-hint">Обновятся участники с указанными ролями. Недоступные участники и ники длиннее 32 символов будут пропущены.</p>
	</div>
}

export function Settings({ config, setConfig, resources, draft, setDraft, api, run, notify, access = false }: PageServices & { config: Config; setConfig: Setter<Config | null>; resources: Resources; draft: SettingsDraft; setDraft: Setter<SettingsDraft>; access?: boolean }) {
	const modal = useModal()
	const [search, setSearch] = useState('')
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const set = (key: string, value: SettingValue) => setDraft(previous => ({ ...previous, [key]: value }))
	function save(event: React.FormEvent) {
		event.preventDefault()
		const values = Object.fromEntries(config.settings.filter(field => field.key.startsWith('ACCESS_') === access && JSON.stringify(field.value) !== JSON.stringify(draft[field.key])).map(field => [field.key, draft[field.key]]))
		if (!Object.keys(values).length) return notify('Нет изменений для сохранения.')
		run(async () => { setConfig(await api('settings', { revision: config.revision, values })); notify('Настройки сохранены и применены.') })
	}
	async function syncPrefixes(field: SettingField) {
		if (!await modal({ title: 'Сохранить префиксы и обновить ники?', message: 'Бот сохранит список и обновит ники участников с указанными ролями. Остальные несохранённые настройки не применятся.', confirm: 'Обновить ники' })) return
		run(async () => {
			setConfig(await api('settings', { revision: config.revision, values: { [field.key]: draft[field.key] } }))
			notify('Префиксы сохранены. Обновляются участники…')
			try {
				const result = await api('role-prefixes/sync', {})
				notify(`Обновлено: ${result.updated}. Уже актуальны: ${result.unchanged}. Пропущено: ${result.skipped}. Ошибок: ${result.failed}.`, result.failed > 0 || result.skipped > 0)
			} catch (error) { throw new Error('Префиксы сохранены, но обновление участников не завершено: ' + errorMessage(error)) }
		})
	}
	const fieldsForPage = config.settings.filter(field => field.key.startsWith('ACCESS_') === access)
	const category = (key: string) => key.startsWith('MAJESTIC_') ? 'Majestic' : /TELEGRAM|DISCORD_NOTIFICATION/.test(key) ? 'Telegram и рассылки' : /ARCHIVE|PARENT_CHANNEL|AUTO_ROLE/.test(key) ? 'Архивы' : /CAPT|PLUS_CHANNEL|PRIORITY/.test(key) ? 'Капты и сборы' : /INVITE|LOG_CHANNEL|MAIN_ROLE|FAMILY_ADDITIONAL/.test(key) ? 'Заявки и принятие' : /PREFIX/.test(key) ? 'Префиксы участников' : 'Общие настройки'
	const categories = Object.entries(fieldsForPage.reduce<Record<string, SettingField[]>>((groups, field) => { const title = access ? 'Дополнительные роли доступа' : category(field.key); (groups[title] ||= []).push(field); return groups }, {})).map(([title, fields]) => [title, fields!.filter(field => `${field.label} ${field.key} ${title}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru').trim()))] as [string, SettingField[]])

	return <form className="grid gap-6" onSubmit={save} noValidate><Field label="Поиск настроек"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Название настройки или категории" /></Field>{!categories.some(([, fields]) => fields.length) && <p role="status" className="text-muted">Настройки не найдены</p>}{access && <div className="callout">Администраторы сервера и роли модераторов бота всегда сохраняют доступ. Здесь указаны только дополнительные роли.</div>}{categories.filter(([, fields]) => fields.length).map(([title, fields]) => <details className="panel" key={title} open={Boolean(search.trim()) || Boolean(expanded[title])} onToggle={event => { if (!search.trim()) { const open = event.currentTarget.open; setExpanded(previous => previous[title] === open ? previous : { ...previous, [title]: open }) } }}><summary className="p-5 font-medium">{title}<span className="ml-2 text-xs text-muted">{fields.length}</span></summary><div className={`grid gap-6 p-5 sm:p-6 ${title === 'Каналы' ? 'lg:grid-cols-2' : ''}`}>
		{fields.map(field => field.type === 'rolePrefixes' ? <RolePrefixes key={field.key} field={field} value={Array.isArray(draft[field.key]) ? draft[field.key] as RolePrefix[] : []} onChange={value => set(field.key, value)} resources={resources} onSync={() => syncPrefixes(field)} />
			: field.type === 'boolean' ? <label key={field.key} className="toggle-row"><span className="text-sm">{field.label}</span><input type="checkbox" role="switch" checked={Boolean(draft[field.key])} onChange={event => set(field.key, event.target.checked)} /><span className="toggle-track" aria-hidden="true" /></label>
				: field.type === 'color' ? <Field key={field.key} label={field.label}><input type="color" value={String(draft[field.key] ?? '')} onChange={event => set(field.key, event.target.value)} /></Field>
					: <OrderedChoices key={field.key} field={field} value={draft[field.key]} onChange={value => set(field.key, value)} resources={resources} hiddenRoles={access ? String(config.settings.find(item => item.key === 'ADMIN_ROLES')?.value ?? '').split(',').map(id => id.trim()).filter(Boolean) : []} />)}
	</div></details>)}<div className="flex flex-wrap items-center justify-between gap-4"><p className="text-xs text-muted">Настройки применяются без перезапуска бота</p><Button type="submit" variant="primary" icon={Save}>Сохранить настройки</Button></div></form>
}
