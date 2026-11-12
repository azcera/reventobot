import type { Resource } from '../types'
import { Field } from './ui'

export function RoleChoices({ label, value, roles, onChange }: { label: string; value: string; roles: Resource[]; onChange(value: string): void }) {
	const selected = value.split(',').filter(Boolean)
	return <Field label={label} hint="Можно выбрать несколько ролей. Без дополнительных ролей доступ есть у администраторов и старшего состава."><div className="grid gap-2">
		<select aria-label={label} value="" onChange={event => { if (event.target.value) onChange([...selected, event.target.value].join(',')) }}><option value="">Добавить роль…</option>{roles.filter(role => !selected.includes(role.id)).map(role => <option key={role.id} value={role.id}>@ {role.name}</option>)}</select>
		{selected.map(id => <label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked onChange={() => onChange(selected.filter(item => item !== id).join(','))} />{roles.find(role => role.id === id)?.name || 'Недоступна · ' + id}</label>)}
	</div></Field>
}
