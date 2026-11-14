import type { Config, Resources, PageServices, Setter, RoleCurator } from '../types'
import { errorMessage } from '../types'
import React, { useEffect, useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { RoleChoices } from '../components/RoleChoices'
import { ActionBar, SaveStatus, Button, Field, IconButton, Panel, useModal } from '../components/ui'

export function RoleCurators({ active, resources, api, run, notify, setConfig }: PageServices & { active: boolean; resources: Resources; setConfig: Setter<Config | null> }) {
	const [curators, setCurators] = useState<RoleCurator[] | null>(null)
	const [revision, setRevision] = useState(0)
	const [saved, setSaved] = useState('')
	const modal = useModal()
	useEffect(() => { if (active && !curators) api('role-curators').then(data => { setCurators(data.curators); setSaved(JSON.stringify(data.curators)); setRevision(data.revision) }).catch(error => notify(error.message, true)) }, [active, curators, api, notify])
	if (!curators) return <p className="text-sm text-muted">Загрузка кураторов…</p>
	const edit = (index: number, value: Partial<RoleCurator>) => setCurators(previous => previous!.map((curator, i) => i === index ? { ...curator, ...value } : curator))
	return <div className="grid gap-6"><div className="callout">Кураторы управляют только назначенными им ролями через ПКМ по участнику → Приложения → Управление ролями. Панель видит только вызвавший её пользователь. Право «Управлять ролями» кураторам не требуется. Если у пользователя несколько ролей куратора, их разрешения объединяются.</div>
		{curators.map((curator, index) => <Panel key={index} title={resources.roles.find(role => role.id === curator.roleId)?.name || `Куратор ${index + 1}`} action={<IconButton icon={Trash2} label="Удалить куратора" onClick={async () => { if (await modal({ title: 'Удалить куратора?', message: 'После сохранения эта роль потеряет назначенные здесь разрешения.', confirm: 'Удалить' })) setCurators(curators.filter((_, i) => i !== index)) }} />}>
			<div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
				<Field label="Роль куратора"><select value={curator.roleId} onChange={event => edit(index, { roleId: event.target.value })}><option value="">Выберите роль…</option>
					{curator.roleId && !resources.roles.some(role => role.id === curator.roleId) && <option value={curator.roleId}>Недоступна · {curator.roleId}</option>}
					{resources.roles.filter(role => role.id === curator.roleId || !curators.some(item => item.roleId === role.id)).map(role => <option key={role.id} value={role.id}>@ {role.name}</option>)}
				</select></Field>
				<RoleChoices label="Доступные для управления роли" hint="Куратор сможет добавлять и убирать только эти роли. Роль бота должна находиться выше них." value={curator.managedRoleIds.join(',')} roles={resources.roles.filter(role => role.manageable !== false)} onChange={value => edit(index, { managedRoleIds: value.split(',').filter(Boolean) })} />
			</div>
		</Panel>)}
		{!curators.length && <p className="text-sm text-muted">Кураторы ещё не добавлены. Доступ к управлению ролями закрыт для всех.</p>}
		<div><Button icon={Plus} onClick={() => setCurators([...curators, { roleId: '', managedRoleIds: [] }])}>Добавить куратора</Button></div>
		<ActionBar><SaveStatus dirty={JSON.stringify(curators) !== saved} />
			<Button variant="primary" icon={Save} onClick={() => run(async () => {
				let data
				try { data = await api('role-curators', { curators, revision }) }
				catch (error) {
					if (errorMessage(error).startsWith('Настройки сохранены')) { const saved = await api('role-curators'); setCurators(saved.curators); setSaved(JSON.stringify(saved.curators)); setRevision(saved.revision); setConfig(await api('config')) }
					throw error
				}
				setCurators(data.curators); setSaved(JSON.stringify(data.curators)); setRevision(data.revision); setConfig(await api('config')); notify('Кураторы ролей сохранены.')
			})}>Сохранить кураторов</Button>
		</ActionBar>
	</div>
}
