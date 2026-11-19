import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RoleChoices } from '../components/RoleChoices'
import {
	ActionBar,
	Button,
	Field,
	IconButton,
	Panel,
	useModal
} from '../components/ui'
import { useFormDraft } from '../lib/drafts'
import type {
	Config,
	PageServices,
	Resources,
	RoleCurator,
	Setter
} from '../types'
import { errorMessage, errorStatus } from '../types'

export function RoleCurators({
	active,
	configRevision,
	resources,
	api,
	run,
	notify,
	setConfig
}: PageServices & {
	active: boolean
	configRevision: number
	resources: Resources
	setConfig: Setter<Config | null>
}) {
	const [saved, setSaved] = useState<RoleCurator[] | null>(null)
	const [revision, setRevision] = useState<number | null>(null)
	const [failed, setFailed] = useState(false)
	const [retry, setRetry] = useState(0)
	const {
		value: curators,
		setValue: setCurators,
		conflict,
		reset
	} = useFormDraft('role-curators', saved)
	const modal = useModal()
	function accept(data: { curators: RoleCurator[]; revision: number }) {
		setSaved(data.curators)
		setRevision(data.revision)
	}
	useEffect(() => {
		if (!active) return
		let cancelled = false
		setFailed(false)
		api('role-curators')
			.then(data => {
				if (!cancelled) accept(data)
			})
			.catch(error => {
				if (!cancelled) {
					setFailed(true)
					notify(errorMessage(error), true)
				}
			})
		return () => {
			cancelled = true
		}
	}, [active, configRevision, retry, api, notify])
	const retryLoad = () => setRetry(value => value + 1)
	if (!curators)
		return failed ? (
			<Button
				icon={RefreshCw}
				onClick={retryLoad}
			>
				Повторить загрузку кураторов
			</Button>
		) : (
			<p className='text-sm text-muted'>Загрузка кураторов…</p>
		)
	const edit = (index: number, value: Partial<RoleCurator>) =>
		setCurators(previous =>
			previous!.map((curator, i) =>
				i === index ? { ...curator, ...value } : curator
			)
		)
	return (
		<div className='page-stack'>
			{failed && (
				<Button
					icon={RefreshCw}
					onClick={retryLoad}
				>
					Повторить загрузку кураторов
				</Button>
			)}
			{conflict && (
				<Button
					icon={RefreshCw}
					onClick={reset}
				>
					Заменить черновик кураторов актуальными данными
				</Button>
			)}
			<div className='callout'>
				Кураторы управляют только назначенными им ролями через ПКМ по участнику
				→ Приложения → Управление ролями. Панель видит только вызвавший её
				пользователь. Право «Управлять ролями» кураторам не требуется. Если у
				пользователя несколько ролей куратора, их разрешения объединяются.
			</div>
			{curators.map((curator, index) => (
				<Panel
					key={index}
					title={
						resources.roles.find(role => role.id === curator.roleId)?.name ||
						`Куратор ${index + 1}`
					}
					action={
						<IconButton
							icon={Trash2}
							label='Удалить куратора'
							onClick={async () => {
								if (
									await modal({
										title: 'Удалить куратора?',
										message:
											'После сохранения эта роль потеряет назначенные здесь разрешения.',
										confirm: 'Удалить'
									})
								)
									setCurators(curators.filter((_, i) => i !== index))
							}}
						/>
					}
				>
					<div className='panel-body grid gap-5 sm:grid-cols-2'>
						<Field label='Роль куратора'>
							<select
								value={curator.roleId}
								onChange={event => edit(index, { roleId: event.target.value })}
							>
								<option value=''>Выберите роль…</option>
								{curator.roleId &&
									!resources.roles.some(role => role.id === curator.roleId) && (
										<option value={curator.roleId}>
											Недоступна · {curator.roleId}
										</option>
									)}
								{resources.roles
									.filter(
										role =>
											role.id === curator.roleId ||
											!curators.some(item => item.roleId === role.id)
									)
									.map(role => (
										<option
											key={role.id}
											value={role.id}
										>
											@ {role.name}
										</option>
									))}
							</select>
						</Field>
						<RoleChoices
							label='Доступные для управления роли'
							hint='Куратор сможет добавлять и убирать только эти роли. Роль бота должна находиться выше них.'
							value={curator.managedRoleIds.join(',')}
							roles={resources.roles.filter(role => role.manageable !== false)}
							onChange={value =>
								edit(index, {
									managedRoleIds: value.split(',').filter(Boolean)
								})
							}
						/>
					</div>
				</Panel>
			))}
			{!curators.length && (
				<p className='text-sm text-muted'>
					Кураторы ещё не добавлены. Доступ к управлению ролями закрыт для всех.
				</p>
			)}
			<div>
				<Button
					icon={Plus}
					onClick={() =>
						setCurators([...curators, { roleId: '', managedRoleIds: [] }])
					}
				>
					Добавить куратора
				</Button>
			</div>
			<ActionBar>
				<Button
					variant='primary'
					icon={Save}
					disabled={conflict || failed || revision === null}
					onClick={() =>
						run(async () => {
							let data
							try {
								data = await api('role-curators', { curators, revision })
							} catch (error) {
								if (errorStatus(error) === 409) retryLoad()
								if (errorMessage(error).startsWith('Настройки сохранены')) {
									accept(await api('role-curators'))
									reset()
									setConfig(await api('config'))
								}
								throw error
							}
							accept(data)
							reset()
							setConfig(await api('config'))
							notify('Кураторы ролей сохранены.')
						})
					}
				>
					Сохранить кураторов
				</Button>
			</ActionBar>
		</div>
	)
}
