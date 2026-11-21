import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MapPage } from '../../../shared/tactics'
import { Button, Field, Panel } from '../components/ui'
import type { Config, PageServices, Resources, Setter, SettingsDraft } from '../types'
import { errorMessage } from '../types'
import { OrderedChoices } from './Settings'

export function Tactics({ config, setConfig, resources, draft, setDraft, api, run, notify }: PageServices & {
	config: Config
	setConfig: Setter<Config | null>
	resources: Resources
	draft: SettingsDraft
	setDraft: Setter<SettingsDraft>
}) {
	const field = config.settings.find(setting => setting.key === 'TACTICS_EDITOR_ROLES')
	const [name, setName] = useState('')
	const [file, setFile] = useState<File | null>(null)
	const [fileKey, setFileKey] = useState(0)
	const [search, setSearch] = useState('')
	const [generation, setGeneration] = useState(0)
	const [page, setPage] = useState<MapPage>({ maps: [], next: null })
	const [loadedSearch, setLoadedSearch] = useState<string | null>(null)
	const query = new URLSearchParams({ search: search.trim() })

	useEffect(() => {
		let active = true
		const timeout = window.setTimeout(() => {
			void api(`tactics/maps?${new URLSearchParams({ search: search.trim() })}`).then(result => {
				if (active) {
					setPage(result)
					setLoadedSearch(search)
				}
			}).catch(error => { if (active) notify(errorMessage(error), true) })
		}, 150)
		return () => { active = false; clearTimeout(timeout) }
	}, [api, generation, notify, search])

	function upload(event: FormEvent) {
		event.preventDefault()
		if (!file || !name.trim()) return
		if (file.size > 12 * 1024 * 1024) return notify('Файл должен быть не больше 12 МБ.', true)
		void run(async () => {
			await api(`tactics/maps/upload?${new URLSearchParams({ name: name.trim() })}`, file)
			setName('')
			setFile(null)
			setFileKey(key => key + 1)
			setGeneration(value => value + 1)
			notify('Карта добавлена.')
		})
	}

	return <div className='page-stack'>
		{field && <Panel title='Роли редакторов'>
			<form className='panel-body grid gap-4' onSubmit={event => {
				event.preventDefault()
				void run(async () => {
					setConfig(await api('settings', { revision: config.revision, values: { [field.key]: draft[field.key] } }))
					notify('Роли редакторов сохранены.')
				})
			}}>
				<OrderedChoices field={field} value={draft[field.key] ?? field.value} resources={resources}
					hiddenRoles={resources.roles.filter(role => role.name === '@everyone').map(role => role.id)}
					onChange={value => setDraft(current => ({ ...current, [field.key]: value }))} />
				<p>Администраторы Discord всегда могут редактировать. Остальные участники без выбранной роли могут смотреть доску.</p>
				<Button type='submit' disabled={draft[field.key] === undefined || draft[field.key] === field.value}>Сохранить роли</Button>
			</form>
		</Panel>}
		<Panel title='Загрузка карты'>
			<form className='panel-body grid gap-4' onSubmit={upload}>
				<Field label='Название карты'>
					<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} />
				</Field>
				<Field label='Изображение PNG, JPEG или WebP до 12 МБ'>
					<input key={fileKey} required type='file' accept='image/png,image/jpeg,image/webp'
						onChange={event => setFile(event.target.files?.[0] ?? null)} />
				</Field>
				<Button type='submit' variant='primary' disabled={!file || !name.trim()}>Добавить карту</Button>
			</form>
		</Panel>
		<Panel title='Каталог карт'>
			<div className='panel-body grid gap-4'>
				<Field label='Поиск по названию'>
					<input type='search' value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
				</Field>
				{loadedSearch === search && !page.maps.length && <p>Карты не найдены.</p>}
				{loadedSearch === search && page.maps.map(map => <div key={map.id} className='flex items-center justify-between gap-3'>
					<span>{map.name}{map.archived && ' · в архиве'}</span>
					<Button onClick={() => void run(async () => {
						await api('tactics/maps/archive', { id: map.id, archived: !map.archived })
						setGeneration(value => value + 1)
						notify(map.archived ? 'Карта восстановлена.' : 'Карта в архиве. Сохранённые тактики доступны.')
					})}>{map.archived ? 'Восстановить' : 'Архивировать'}</Button>
				</div>)}
				{loadedSearch === search && page.next && <Button onClick={() => void run(async () => {
					query.set('cursor', page.next!)
					const result = await api(`tactics/maps?${query}`)
					setPage(current => current.next === page.next ? { maps: [...current.maps, ...result.maps], next: result.next } : current)
				})}>Ещё карты</Button>}
			</div>
		</Panel>
	</div>
}
