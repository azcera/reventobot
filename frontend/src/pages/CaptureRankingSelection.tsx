import { useEffect, useState } from 'react'
import { Button } from '../components/ui'
import type { Api, ApiRoutes } from '../types'
import { errorMessage } from '../types'

type CaptureList = ApiRoutes['capture-ranking/captures']
type Capture = CaptureList['captures'][number]
const date = new Intl.DateTimeFormat('ru-RU', {
	dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow'
})

function CaptureRow({
	capture, checked, disabled, onChange
}: {
	capture: Capture
	checked: boolean
	disabled: boolean
	onChange(included: boolean): void
}) {
	const [expanded, setExpanded] = useState(false)
	const title = `${date.format(capture.at)} · ${capture.enemy} · ${capture.result}`
	return (
		<li className='flex items-start gap-3 border-b py-3'>
			<input type='checkbox' className='mt-1 shrink-0'
				aria-label={`Учитывать капт: ${title}`}
				checked={checked} disabled={disabled}
				onChange={event => onChange(event.target.checked)} />
			<details className='min-w-0 flex-1' onToggle={event => setExpanded(event.currentTarget.open)}>
				<summary className='break-words text-sm font-medium'>{title}</summary>
				{expanded && (
					<div className='mt-2 overflow-x-auto'>
						<p className='mb-2 text-sm text-muted'>{capture.attack ? 'Атака' : 'Защита'}</p>
						<table className='w-full text-left text-sm'>
							<thead><tr>
								{['Игрок', 'Урон', 'Киллы', 'Смерти', 'MVP'].map(label =>
									<th key={label} scope='col' className='px-2 py-1'>{label}</th>
								)}
							</tr></thead>
							<tbody>
								{capture.players.map(player => (
									<tr key={player.staticId} className='border-t'>
										<td className='px-2 py-1'>{player.name} ({player.staticId})</td>
										<td className='px-2 py-1'>{player.damage ?? '—'}</td>
										<td className='px-2 py-1'>{player.kills ?? '—'}</td>
										<td className='px-2 py-1'>{player.deaths ?? '—'}</td>
										<td className='px-2 py-1'>{player.mvp}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</details>
		</li>
	)
}

export function CaptureRankingSelection({
	api, close, onSaved
}: { api: Api; close(): void; onSaved(): void }) {
	const [result, setResult] = useState<CaptureList>()
	const [draft, setDraft] = useState<Record<string, boolean>>({})
	const [error, setError] = useState('')
	const [saving, setSaving] = useState(false)
	useEffect(() => {
		let active = true
		void api('capture-ranking/captures').then(
			data => { if (active) setResult(data) },
			caught => { if (active) setError(errorMessage(caught)) }
		)
		return () => { active = false }
	}, [api])
	const changes = (result?.captures ?? []).flatMap(capture =>
		Object.hasOwn(draft, capture.key) && draft[capture.key] !== capture.included
			? [{ key: capture.key, included: draft[capture.key] }]
			: []
	)
	async function save() {
		if (saving || !changes.length) return
		setError('')
		setSaving(true)
		try {
			await api('capture-ranking/captures', { changes })
			onSaved()
			close()
		} catch (caught) {
			setError(errorMessage(caught))
		} finally {
			setSaving(false)
		}
	}
	return (
		<div className='grid gap-4'>
			{error && <p role='alert'>{error}</p>}
			{result?.captures.length ? (
				<ul className='max-h-[54dvh] overflow-y-auto pr-1'>
					{result.captures.map(capture => (
						<CaptureRow key={capture.key} capture={capture}
							checked={draft[capture.key] ?? capture.included} disabled={saving}
							onChange={included => setDraft(previous => ({ ...previous, [capture.key]: included }))} />
					))}
				</ul>
			) : result ? (
				<p role='status'>{result.ready ? 'Сыгранных каптов пока нет.' : 'Статистика каптов ещё загружается.'}</p>
			) : !error && <p role='status'>Загружаются капты…</p>}
			<div className='flex flex-wrap justify-end gap-2'>
				<Button type='button' disabled={saving} onClick={close}>Отмена</Button>
				<Button type='button' variant='primary' disabled={saving || !changes.length}
					onClick={() => void save()}>Сохранить выбор</Button>
			</div>
		</div>
	)
}
