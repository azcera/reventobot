import { Check, FolderPlus, GripVertical, ImagePlus, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import type { CatalogMap, MapCatalog, MapCategory, TacticInfo } from '../../../shared/tactics'
import { Field, IconButton, Panel, useModal } from '../components/ui'
import type { Config, PageServices, Resources, Setter, SettingsDraft } from '../types'
import { errorMessage } from '../types'
import { OrderedChoices } from './Settings'

type MapFields = { name: string; categoryId: string; file: File | null }
type DropTarget = { id: string; after: boolean }

function FormActions({ close, label, icon = Check }: {
	close(): void
	label: string
	icon?: typeof Check
}) {
	return <div className='flex justify-end gap-2'>
		<IconButton icon={X} label='Отмена' onClick={close} />
		<IconButton icon={icon} label={label} type='submit' />
	</div>
}

function CategoryForm({ close, save }: { close(): void; save(name: string): void }) {
	return <form className='mt-5 grid gap-4' onSubmit={event => {
		event.preventDefault()
		const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
		if (name) save(name)
	}}>
		<Field label='Название категории'><input name='name' autoFocus required maxLength={100} /></Field>
		<FormActions close={close} label='Создать категорию' />
	</form>
}

function MapForm({ close, save, category, categories, map }: {
	close(): void
	save(fields: MapFields): void
	category: MapCategory
	categories: MapCategory[]
	map?: CatalogMap
}) {
	const [file, setFile] = useState<File | null>(null)
	const [preview, setPreview] = useState('')
	useEffect(() => {
		setPreview('')
		if (!file || file.size > 12 * 1024 * 1024) return
		const reader = new FileReader()
		reader.onload = () => setPreview(String(reader.result))
		reader.readAsDataURL(file)
		return () => reader.abort()
	}, [file])

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const values = new FormData(event.currentTarget)
		const name = String(values.get('name') ?? '').trim()
		const categoryId = String(values.get('categoryId') ?? category.id)
		if (name && (map || file)) save({ name, categoryId, file })
	}

	return <form className='mt-5 grid gap-4' onSubmit={submit}>
		<Field label='Название карты'><input name='name' defaultValue={map?.name} autoFocus required maxLength={100} /></Field>
		{map && <Field label='Категория'>
			<select name='categoryId' defaultValue={map.categoryId}>
				{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
			</select>
		</Field>}
		<label className='flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-current/30 p-4 hover:border-current focus-within:outline focus-within:outline-2'>
			<input className='sr-only' type='file' accept='image/png,image/jpeg,image/webp'
				aria-label={map ? 'Заменить изображение' : 'Изображение карты'}
				required={!map} onChange={event => setFile(event.target.files?.[0] ?? null)} />
			{preview ? <img className='h-14 w-20 rounded-md object-cover' src={preview} alt='' /> : <ImagePlus size={28} className='shrink-0' />}
			<span className='min-w-0'>
				<span className='block truncate font-medium'>{file?.name ?? (map ? 'Заменить изображение' : 'Выбрать изображение')}</span>
				<span className='block text-sm text-muted'>PNG, JPEG или WebP · до 12 МБ</span>
			</span>
		</label>
		<FormActions close={close} label={map ? 'Сохранить карту' : 'Добавить карту'} />
	</form>
}

export function Tactics({ config, setConfig, resources, draft, setDraft, api, run, notify }: PageServices & {
	config: Config
	setConfig: Setter<Config | null>
	resources: Resources
	draft: SettingsDraft
	setDraft: Setter<SettingsDraft>
}) {
	const field = config.settings.find(setting => setting.key === 'TACTICS_EDITOR_ROLES')
	const [catalog, setCatalog] = useState<MapCatalog | null>(null)
	const [search, setSearch] = useState('')
	const [generation, setGeneration] = useState(0)
	const [dragging, setDragging] = useState<string | null>(null)
	const [target, setTarget] = useState<DropTarget | null>(null)
	const drag = useRef<{ id: string; categoryId: string; pointerId: number } | null>(null)
	const modal = useModal()
	const refresh = () => setGeneration(value => value + 1)

	useEffect(() => {
		let active = true
		void api('tactics/catalog').then(result => {
			if (active) setCatalog(result)
		}).catch(error => { if (active) notify(errorMessage(error), true) })
		return () => { active = false }
	}, [api, generation, notify])

	function createCategory() {
		void modal({
			title: 'Новая категория', hideFooter: true,
			content: ({ close }) => <CategoryForm close={close} save={name => void run(async () => {
				const category = await api('tactics/categories/create', { name })
				setCatalog(current => current && { ...current, categories: [...current.categories, category] })
				close()
				refresh()
				notify('Категория создана.')
			})} />
		})
	}

	function editMap(category: MapCategory, map?: CatalogMap) {
		void modal({
			title: map ? 'Редактировать карту' : `Новая карта · ${category.name}`,
			hideFooter: true,
			content: ({ close }) => <MapForm category={category} categories={catalog?.categories ?? []}
				map={map} close={close} save={({ name, categoryId, file }) => {
					if (file && file.size > 12 * 1024 * 1024) return notify('Файл должен быть не больше 12 МБ.', true)
					void run(async () => {
						const fields = { name, categoryId }
						if (!map && file) await api(`tactics/maps/upload?${new URLSearchParams(fields)}`, file)
						else if (map) {
							const edit = { ...fields, id: map.id }
							if (file) await api(`tactics/maps/edit?${new URLSearchParams(edit)}`, file)
							else await api('tactics/maps/edit', edit)
						}
						close()
						refresh()
						notify(map ? 'Изменения карты сохранены.' : 'Карта добавлена.')
					})
				}} />
		})
	}

	function remove(map: CatalogMap, tactic?: TacticInfo) {
		void modal({
			title: tactic ? `Удалить тактику «${tactic.name}»?` : `Удалить карту «${map.name}»?`,
			message: tactic ? undefined : 'Будут удалены изображение карты, все её сохранённые тактики и открытые на ней доски.',
			danger: true,
			hideFooter: true,
			content: ({ close }) => <form className='mt-5' onSubmit={event => {
				event.preventDefault()
				void run(async () => {
					if (tactic) await api('tactics/presets/delete', { id: tactic.id, mapId: map.id })
					else await api('tactics/maps/delete', { id: map.id })
					close()
					refresh()
					notify(tactic ? 'Тактика удалена.' : 'Карта и её тактики удалены.')
				})
			}}><FormActions close={close} icon={Trash2} label={tactic ? 'Подтвердить удаление тактики' : 'Подтвердить удаление карты'} /></form>
		})
	}

	function reorder(categoryId: string, id: string, drop: DropTarget) {
		void run(async () => {
			await api('tactics/maps/reorder', { categoryId, id, targetId: drop.id, after: drop.after })
			refresh()
			notify('Порядок карт сохранён.')
		})
	}

	function findTarget(event: PointerEvent): DropTarget | null {
		const active = drag.current
		const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-tactics-map]')
		if (!active || !row || row.dataset.category !== active.categoryId || row.dataset.tacticsMap === active.id) return null
		const bounds = row.getBoundingClientRect()
		return { id: row.dataset.tacticsMap!, after: event.clientY >= bounds.top + bounds.height / 2 }
	}

	function cancelDrag() {
		drag.current = null
		setDragging(null)
		setTarget(null)
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
				<div className='flex justify-end'>
					<IconButton icon={Check} label='Сохранить роли' type='submit' disabled={draft[field.key] === undefined || draft[field.key] === field.value} />
				</div>
			</form>
		</Panel>}
		<Panel title='Каталог карт' action={<div className='flex gap-2'>
			<IconButton icon={RefreshCw} label='Обновить каталог' onClick={refresh} />
			<IconButton icon={FolderPlus} label='Добавить категорию' onClick={createCategory} />
		</div>}>
			<div className='panel-body grid gap-5'>
				<Field label='Поиск по названию карты'>
					<input type='search' value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
				</Field>
				{catalog?.categories.length === 0 && <p className='text-muted'>Добавьте категорию, чтобы загрузить первую карту.</p>}
				{catalog?.categories.map(category => {
					const maps = catalog.maps.filter(map => map.categoryId === category.id &&
						map.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
					return <section key={category.id} aria-label={category.name} className='rounded-xl border border-current/15 p-3 sm:p-4'>
						<div className='mb-3 flex items-center justify-between gap-3'>
							<h3 className='min-w-0 break-words font-semibold'>{category.name}</h3>
							<IconButton icon={Plus} label={`Добавить карту в «${category.name}»`} onClick={() => editMap(category)} />
						</div>
						{!maps.length && <p className='text-sm text-muted'>{search ? 'Карты не найдены.' : 'В категории пока нет карт.'}</p>}
						<div className='grid gap-2'>
							{maps.map((map, index) => <div key={map.id} data-tactics-map={map.id} data-category={category.id}
								className={`relative rounded-lg border border-current/10 p-2 ${dragging === map.id ? 'opacity-50' : ''}`}>
								{target?.id === map.id && <div className={`pointer-events-none absolute inset-x-0 h-0.5 rounded bg-sky-400 ${target.after ? '-bottom-1' : '-top-1'}`} />}
								<div className='flex items-center gap-2'>
									<IconButton icon={GripVertical} label={`Переместить карту «${map.name}»`} className='cursor-grab touch-none active:cursor-grabbing'
										disabled={maps.length < 2} aria-keyshortcuts='ArrowUp ArrowDown'
										onPointerDown={event => {
											if (event.button !== 0 || drag.current) return
											drag.current = { id: map.id, categoryId: category.id, pointerId: event.pointerId }
											event.currentTarget.setPointerCapture(event.pointerId)
											setDragging(map.id)
										}}
										onPointerMove={event => {
											if (drag.current?.pointerId === event.pointerId) setTarget(findTarget(event))
										}}
										onPointerUp={event => {
											const active = drag.current
											if (!active || active.pointerId !== event.pointerId) return
											const drop = findTarget(event)
											cancelDrag()
											if (drop) reorder(active.categoryId, active.id, drop)
										}}
										onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
										onKeyDown={event => {
											if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
											event.preventDefault()
											const after = event.key === 'ArrowDown'
											const neighbour = maps[index + (after ? 1 : -1)]
											if (neighbour) reorder(category.id, map.id, { id: neighbour.id, after })
										}} />
									<strong className='min-w-0 flex-1 break-words text-sm'>{map.name}</strong>
									<IconButton icon={Pencil} label={`Редактировать карту «${map.name}»`} onClick={() => editMap(category, map)} />
									<IconButton icon={Trash2} label={`Удалить карту «${map.name}»`} onClick={() => remove(map)} />
								</div>
								{map.tactics.length ? <ul className='ml-3 mt-1 grid gap-1 border-l border-current/15 pl-3'>
									{map.tactics.map(tactic => <li key={tactic.id} className='flex items-center justify-between gap-2 text-sm'>
										<span className='min-w-0 break-words'>{tactic.name}</span>
										<IconButton icon={Trash2} label={`Удалить тактику «${tactic.name}»`} onClick={() => remove(map, tactic)} />
									</li>)}
								</ul> : <p className='ml-11 text-xs text-muted'>Тактик нет</p>}
							</div>)}
						</div>
					</section>
				})}
			</div>
		</Panel>
	</div>
}
