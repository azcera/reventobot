import type { Resource } from '../types'
import { useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

export function RoleChoices({ label, value, roles, onChange, hint = 'Можно выбрать несколько ролей. Без дополнительных ролей доступ есть у администраторов и старшего состава.' }: { label: string; value: string; roles: Resource[]; onChange(value: string): void; hint?: string }) {
	const id = useId()
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [active, setActive] = useState(0)
	const input = useRef<HTMLInputElement>(null)
	const selected = value.split(',').filter(Boolean)
	const options = roles.filter(role => !selected.includes(role.id) && `${role.name} ${role.id}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))
	const index = Math.min(active, Math.max(0, options.length - 1))
	function choose(role: Resource) { if (input.current?.matches(':disabled')) return; onChange([...selected, role.id].join(',')); setQuery(''); setActive(0); setOpen(false); input.current?.focus() }
	return <div className="role-picker grid content-start gap-2" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
		<label htmlFor={id} className="field-label">{label}</label>
		<div className="role-search">
			<Search aria-hidden="true" />
			<input ref={input} id={id} role="combobox" aria-expanded={open} aria-controls={id + '-options'} aria-autocomplete="list" aria-activedescendant={open && options.length ? `${id}-option-${index}` : undefined} aria-describedby={id + '-hint'} autoComplete="off" placeholder="Найти и добавить роль…" value={query}
				onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }} onKeyDown={event => {
					if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) event.preventDefault()
					if (event.key === 'Escape') { setOpen(false); event.stopPropagation() }
					else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { setOpen(true); setActive(previous => Math.max(0, Math.min(options.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)))) }
					else if (event.key === 'Enter' && open && options[index]) choose(options[index])
				}} />
			<ChevronDown aria-hidden="true" className={open ? 'rotate-180' : ''} />
		</div>
		{open && <div id={id + '-options'} role="listbox" aria-label={label} className="role-options" data-lenis-prevent>
			{options.length ? options.map((role, i) => <div role="option" id={`${id}-option-${i}`} key={role.id} aria-selected={i === index} className="role-option" onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(i)} onClick={() => choose(role)}><span className="role-dot" /><span>{role.name}</span><Check aria-hidden="true" /></div>) : <p className="p-4 text-xs text-muted">{query ? 'Роли не найдены' : 'Все роли добавлены'}</p>}
		</div>}
		{selected.length > 0 && <div className="role-chips">{selected.map(roleId => <button type="button" className="role-chip" key={roleId} aria-label={`Убрать роль ${roles.find(role => role.id === roleId)?.name || roleId}`} onClick={() => onChange(selected.filter(item => item !== roleId).join(','))}><span className="role-dot" />{roles.find(role => role.id === roleId)?.name || 'Недоступна · ' + roleId}<X aria-hidden="true" /></button>)}</div>}
		<p id={id + '-hint'} className="field-hint">{hint}</p>
	</div>
}
