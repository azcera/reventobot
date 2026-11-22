import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { ArchiveAccessStatus } from '../../../shared/archiveAccess'
import {
	ActionBar,
	Button,
	Field,
	IconButton,
	useModal
} from '../components/ui'
import type {
	Config,
	PageServices,
	Resources,
	RolePrefix,
	Setter,
	SettingField,
	SettingValue,
	SettingsDraft
} from '../types'
import { errorMessage } from '../types'
import { CaptureRanking } from './CaptureRanking'

function ArchiveAccessProgress({ api, run }: Pick<PageServices, 'api' | 'run'>) {
	const [status, setStatus] = useState<ArchiveAccessStatus>()
	const [error, setError] = useState('')
	useEffect(() => {
		let active = true
		const refresh = async () => {
			try {
				const result = await api('archive-access')
				if (active) {
					setStatus(result)
					setError('')
				}
			} catch (caught) {
				if (active) setError(errorMessage(caught))
			}
		}
		void refresh()
		const interval = setInterval(refresh, 3000)
		return () => { active = false; clearInterval(interval) }
	}, [api])
	const labels = {
		off: 'Сверка доступа выключена', queued: 'Сверка доступа в очереди',
		running: 'Сверка доступа выполняется', complete: 'Сверка доступа завершена',
		failed: 'Сверка доступа завершилась с ошибками'
	}
	return <div className='callout'>
		<p role='status'>{error || (status ? labels[status.state] : 'Загружаю состояние сверки')}</p>
		{status && status.state !== 'off' && <>
			<p>Проверено {status.checked} из {status.total}. Изменено {status.changed}.</p>
			{status.issues.length > 0 && <details>
				<summary>Ошибки ({status.issues.length})</summary>
				<ul>{status.issues.map(({ threadId, message }, index) => (
					<li key={threadId ?? index}>{threadId && `Ветка ${threadId} — `}{message}</li>
				))}</ul>
			</details>}
			<Button type='button' icon={RefreshCw} disabled={status.state === 'queued' || status.state === 'running'}
				onClick={() => run(async () => setStatus(await api('archive-access', {})))}>
				Повторить сверку доступа
			</Button>
		</>}
	</div>
}

function MoveActions({
	index,
	length,
	onMove,
	onRemove
}: {
	index: number
	length: number
	onMove(direction: number): void
	onRemove(): void
}) {
	return (
		<div className='flex shrink-0 gap-1'>
			<IconButton
				icon={ArrowUp}
				label='Повысить приоритет'
				disabled={index === 0}
				onClick={() => onMove(-1)}
			/>
			<IconButton
				icon={ArrowDown}
				label='Понизить приоритет'
				disabled={index === length - 1}
				onClick={() => onMove(1)}
			/>
			<IconButton
				icon={Trash2}
				label='Удалить из настройки'
				onClick={onRemove}
			/>
		</div>
	)
}

export function OrderedChoices({
	field,
	value,
	onChange,
	resources,
	hiddenRoles = []
}: {
	field: SettingField
	value: SettingValue
	onChange(value: string): void
	resources: Resources
	hiddenRoles?: string[]
}) {
	const multiple = ['roles', 'channels'].includes(field.type)
	const items = field.type.startsWith('role')
		? resources.roles.filter(role => !hiddenRoles.includes(role.id))
		: resources.channels.filter(channel =>
				field.channelTypes?.includes(channel.type)
			)
	const selected = String(value ?? '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean)
	const prefix = field.type.startsWith('role') ? '@ ' : '# '
	return (
		<div className='grid gap-3'>
			<Field label={field.label}>
				<select
					value={multiple ? '' : String(value ?? '')}
					onChange={event => {
						if (!multiple) return onChange(event.target.value)
						if (event.target.value && !selected.includes(event.target.value))
							onChange([...selected, event.target.value].join(','))
					}}
				>
					<option value=''>{multiple ? 'Добавить…' : 'Не выбран'}</option>
					{!multiple && value && !items.some(item => item.id === value) && (
						<option value={String(value)}>Недоступен: {String(value)}</option>
					)}
					{items
						.filter(item => !multiple || !selected.includes(item.id))
						.map(item => (
							<option
								key={item.id}
								value={item.id}
							>
								{prefix}
								{item.name}
							</option>
						))}
				</select>
			</Field>
			{multiple &&
				selected.map(
					(id, index) =>
						!hiddenRoles.includes(id) && (
							<div
								className='ordered-row'
								key={id}
							>
								<span className='min-w-0 flex-1 wrap-break-word text-sm'>
									<span className='mr-2 text-muted'>{index + 1}.</span>
									{prefix}
									{items.find(item => item.id === id)?.name ||
										'Недоступен · ' + id}
								</span>
								<MoveActions
									index={index}
									length={selected.length}
									onMove={direction => {
										const next = [...selected]
										;[next[index], next[index + direction]] = [
											next[index + direction],
											next[index]
										]
										onChange(next.join(','))
									}}
									onRemove={() =>
										onChange(selected.filter(value => value !== id).join(','))
									}
								/>
							</div>
						)
				)}
		</div>
	)
}

function RolePrefixes({
	field,
	value,
	onChange,
	resources,
	onSync
}: {
	field: SettingField
	value: RolePrefix[]
	onChange(value: RolePrefix[]): void
	resources: Resources
	onSync(): void
}) {
	return (
		<div className='grid gap-4'>
			<div>
				<h3 className='subsection-title'>{field.label}</h3>
				<p className='field-hint mt-2'>
					Любой тег, например TAG &gt; или [Dep]. Приоритет сверху вниз. Пробел
					после префикса добавляется автоматически.
				</p>
			</div>
			{value.map((entry, index) => (
				<div
					className='prefix-row'
					key={index}
				>
					<div className='grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_110px]'>
						<select
							aria-label={`Роль для префикса ${index + 1}`}
							value={entry.roleId}
							onChange={event =>
								onChange(
									value.map((item, i) =>
										i === index ? { ...item, roleId: event.target.value } : item
									)
								)
							}
						>
							<option value=''>Выбери роль</option>
							{entry.roleId &&
								!resources.roles.some(role => role.id === entry.roleId) && (
									<option value={entry.roleId}>
										Удалённая роль · {entry.roleId}
									</option>
								)}
							{resources.roles.map(role => (
								<option
									key={role.id}
									value={role.id}
								>
									@ {role.name}
								</option>
							))}
						</select>
						<input
							aria-label={`Префикс ${index + 1}`}
							placeholder='[Dep]'
							value={entry.prefix}
							maxLength={24}
							onChange={event =>
								onChange(
									value.map((item, i) =>
										i === index ? { ...item, prefix: event.target.value } : item
									)
								)
							}
						/>
					</div>
					<MoveActions
						index={index}
						length={value.length}
						onMove={direction => {
							const next = [...value]
							;[next[index], next[index + direction]] = [
								next[index + direction],
								next[index]
							]
							onChange(next)
						}}
						onRemove={() => onChange(value.filter((_, i) => i !== index))}
					/>
				</div>
			))}
			<div className='flex flex-wrap gap-2'>
				<IconButton
					icon={Plus}
					label='Добавить префикс'
					onClick={() => onChange([...value, { roleId: '', prefix: '' }])}
				/>
				<Button
					icon={RefreshCw}
					onClick={onSync}
				>
					Сохранить префиксы и обновить ники
				</Button>
			</div>
			<p className='field-hint'>
				Обновятся участники с указанными ролями. Недоступные участники и ники
				длиннее 32 символов будут пропущены.
			</p>
		</div>
	)
}

export function Settings({
	config,
	setConfig,
	resources,
	draft,
	setDraft,
	api,
	run,
	notify,
	access = false
}: PageServices & {
	config: Config
	setConfig: Setter<Config | null>
	resources: Resources
	draft: SettingsDraft
	setDraft: Setter<SettingsDraft>
	access?: boolean
}) {
	const modal = useModal()
	const [search, setSearch] = useState('')
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const set = (key: string, value: SettingValue) =>
		setDraft(previous => ({ ...previous, [key]: value }))
	function save(event: React.FormEvent) {
		event.preventDefault()
		const values = Object.fromEntries(
			config.settings
				.filter(
					field =>
						field.key !== 'TACTICS_EDITOR_ROLES' && field.key.startsWith('ACCESS_') === access &&
						JSON.stringify(field.value) !== JSON.stringify(draft[field.key])
				)
				.map(field => [field.key, draft[field.key]])
		)
		if (!Object.keys(values).length)
			return notify('Нет изменений для сохранения.')
		run(async () => {
			const saved = await api('settings', { revision: config.revision, values })
			setConfig(saved)
			const syncQueued = saved.settings.some(field => field.key === 'ARCHIVE_MANAGE_ACCESS' && field.value === true) &&
				['ARCHIVE_MANAGE_ACCESS', 'ARCHIVE_VIEWER_ROLES', 'PARENT_CHANNEL_ID'].some(key => Object.hasOwn(values, key))
			notify(syncQueued ? 'Настройки сохранены. Сверка доступа в очереди.' : 'Настройки сохранены и применены.')
		})
	}
	async function syncPrefixes(field: SettingField) {
		if (
			!(await modal({
				title: 'Сохранить префиксы и обновить ники?',
				message:
					'Бот сохранит список и обновит ники участников с указанными ролями. Остальные несохранённые настройки не применятся.',
				confirm: 'Обновить ники'
			}))
		)
			return
		run(async () => {
			setConfig(
				await api('settings', {
					revision: config.revision,
					values: { [field.key]: draft[field.key] }
				})
			)
			notify('Префиксы сохранены. Обновляются участники…')
			try {
				const result = await api('role-prefixes/sync', {})
				notify(
					`Обновлено: ${result.updated}. Уже актуальны: ${result.unchanged}. Пропущено: ${result.skipped}. Ошибок: ${result.failed}.`,
					result.failed > 0 || result.skipped > 0
				)
			} catch (error) {
				throw new Error(
					'Префиксы сохранены, но обновление участников не завершено: ' +
						errorMessage(error)
				)
			}
		})
	}
	const fieldsForPage = config.settings.filter(
		field => field.key !== 'TACTICS_EDITOR_ROLES' && field.key.startsWith('ACCESS_') === access
	)
	const missing = fieldsForPage.filter(
		field =>
			field.key !== 'ARCHIVE_VIEWER_ROLES' &&
			['channel', 'channels', 'role', 'roles'].includes(field.type) &&
			!String(field.value ?? '').trim()
	)
	const missingNotice = missing.length > 0 && (
		<div
			className='callout'
			role='status'
		>
			<p>
				Не заполнено в БД: {missing.length}. Выберите настройку, укажите
				значение и сохраните. Для неиспользуемых функций можно оставить пустым.
			</p>
			<div className='mt-2 flex flex-wrap gap-2'>
				{missing.map(field => (
					<button
						type='button'
						className='text-sm underline'
						key={field.key}
						onClick={() => setSearch(field.key)}
					>
						{field.label}
					</button>
				))}
			</div>
		</div>
	)
	const category = (key: string) => {
		if (key.startsWith('CAPTURE_RANK_')) return 'Рейтинг каптов'
		return key.startsWith('MAJESTIC_')
			? 'Majestic'
			: /TELEGRAM|DISCORD_NOTIFICATION/.test(key)
				? 'Telegram и рассылки'
				: /ARCHIVE|PARENT_CHANNEL|AUTO_ROLE/.test(key)
					? 'Архивы'
					: /CAPT|PLUS_CHANNEL|PRIORITY/.test(key)
						? 'Капты и сборы'
						: /INVITE|LOG_CHANNEL|MAIN_ROLE|FAMILY_ADDITIONAL/.test(key)
							? 'Заявки и принятие'
							: /PREFIX/.test(key)
								? 'Префиксы участников'
								: 'Общие настройки'
	}
	const categories = Object.entries(
		fieldsForPage.reduce<Record<string, SettingField[]>>((groups, field) => {
			const title = access ? 'Дополнительные роли доступа' : category(field.key)
			;(groups[title] ||= []).push(field)
			return groups
		}, {})
	).map(
		([title, fields]) =>
			[
				title,
				fields!.filter(field =>
					`${field.label} ${field.key} ${title}`
						.toLocaleLowerCase('ru')
						.includes(search.toLocaleLowerCase('ru').trim())
				)
			] as [string, SettingField[]]
	)

	return (
		<form
			className='page-stack'
			onSubmit={save}
			noValidate
		>
			{missingNotice}
			<Field label='Поиск настроек'>
				<input
					type='search'
					value={search}
					onChange={event => setSearch(event.target.value)}
					placeholder='Название настройки или категории'
				/>
			</Field>
			{!categories.some(([, fields]) => fields.length) && (
				<p
					role='status'
					className='text-muted'
				>
					Настройки не найдены
				</p>
			)}
			{access && (
				<div className='callout'>
					Администраторы сервера и роли модераторов бота всегда сохраняют
					доступ. Здесь указаны только дополнительные роли.
				</div>
			)}
			{categories
				.filter(([, fields]) => fields.length)
				.map(([title, fields]) => (
					<details
						className='panel'
						key={title}
						open={Boolean(search.trim()) || Boolean(expanded[title])}
						onToggle={event => {
							if (!search.trim()) {
								const open = event.currentTarget.open
								setExpanded(previous =>
									previous[title] === open
										? previous
										: { ...previous, [title]: open }
								)
							}
						}}
					>
						<summary className='panel-heading'>
							<h2 className='section-title'>{title}</h2>
							<span className='ml-2 text-xs text-muted'>{fields.length}</span>
						</summary>
						<div
							className={`panel-body grid gap-6 ${title === 'Каналы' ? 'lg:grid-cols-2' : ''}`}
						>
						{title === 'Архивы' && (expanded[title] || search.trim()) && <ArchiveAccessProgress api={api} run={run} />}
							{fields.map(field =>
								field.type === 'rolePrefixes' ? (
									<RolePrefixes
										key={field.key}
										field={field}
										value={
											Array.isArray(draft[field.key])
												? (draft[field.key] as RolePrefix[])
												: []
										}
										onChange={value => set(field.key, value)}
										resources={resources}
										onSync={() => syncPrefixes(field)}
									/>
								) : field.type === 'boolean' ? (
									<label
										key={field.key}
										className='toggle-row'
									>
										<span className='text-sm'>{field.label}</span>
										<input
											type='checkbox'
											role='switch'
											checked={Boolean(draft[field.key])}
											onChange={event => set(field.key, event.target.checked)}
										/>
										<span
											className='toggle-track'
											aria-hidden='true'
										/>
									</label>
								) : field.type === 'percentage' ? (
									expanded[title] || search.trim() ? (
										<CaptureRanking key={field.key} api={api}
											weight={String(draft[field.key] ?? field.value)}
											revision={config.revision}
											onChange={value => set(field.key, value)} />
									) : null
								) : field.type === 'color' ? (
									<Field
										key={field.key}
										label={field.label}
									>
										<input
											type='color'
											value={String(draft[field.key] ?? '')}
											onChange={event => set(field.key, event.target.value)}
										/>
									</Field>
								) : (
									<OrderedChoices
										key={field.key}
										field={field}
										value={draft[field.key]}
										onChange={value => set(field.key, value)}
										resources={resources}
										hiddenRoles={
											access
												? String(
														config.settings.find(
															item => item.key === 'ADMIN_ROLES'
														)?.value ?? ''
													)
														.split(',')
														.map(id => id.trim())
														.filter(Boolean)
												: []
										}
									/>
								)
							)}
						</div>
					</details>
				))}
			<ActionBar>
				<Button
					type='submit'
					variant='primary'
					icon={Save}
				>
					Сохранить настройки
				</Button>
			</ActionBar>
		</form>
	)
}
