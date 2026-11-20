import { useEffect, useState } from 'react'
import { Button, Field } from '../components/ui'
import type { Api, ApiRoutes } from '../types'
import { errorMessage } from '../types'

export function CaptureRanking({
	api, weight, revision, onChange
}: {
	api: Api
	weight: string
	revision: number
	onChange(value: string): void
}) {
	const [result, setResult] = useState<ApiRoutes['capture-ranking']>()
	const [error, setError] = useState('')
	const [refresh, setRefresh] = useState(0)
	useEffect(() => {
		let active = true
		setError('')
		void api('capture-ranking').then(
			data => { if (active) setResult(data) },
			caught => { if (active) setError(errorMessage(caught)) }
		)
		return () => { active = false }
	}, [api, revision, refresh])
	const change = (value: string, damage = false) => {
		if (!/^\d{0,3}$/.test(value)) return
		const percent = Number(value)
		if (percent > 100) return
		onChange(value === '' ? '' : String(damage ? 100 - percent : percent))
	}
	const average = (number: number) =>
		number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

	return (
		<div className='grid gap-4'>
			<div className='grid gap-3 sm:grid-cols-2'>
				<Field label='Вес киллов (%)'>
					<input type='number' min={0} max={100} step={1} value={weight}
						onChange={event => change(event.target.value)} />
				</Field>
				<Field label='Вес урона (%)'>
					<input type='number' min={0} max={100} step={1}
						value={weight === '' ? '' : 100 - Number(weight)}
						onChange={event => change(event.target.value, true)} />
				</Field>
			</div>
			<p className='text-sm text-muted'>
				Киллы и урон составляют 85% балла в заданной пропорции. Оставшиеся 15% зависят от количества MVP.
			</p>
			<Button type='button' onClick={() => setRefresh(value => value + 1)}>
				Обновить список
			</Button>
			{error ? <p role='alert'>{error}</p> : !result ? (
				<p role='status'>Загружается рейтинг…</p>
			) : !result.ready ? (
				<p role='status'>Ожидается актуальный состав семьи из Majestic.</p>
			) : !result.players.length ? (
				<p role='status'>Пока нет игроков с результатами.</p>
			) : (
				<div className='overflow-x-auto'>
					<table className='w-full text-left text-sm'>
						<thead><tr>
							{['Место', 'Игрок', 'STATIC', 'Капты', 'Ср. урон', 'Ср. киллы', 'MVP'].map(label =>
								<th key={label} scope='col' className='px-2 py-2 whitespace-nowrap'>{label}</th>
							)}
						</tr></thead>
						<tbody>
							{result.players.map(player => <tr key={player.staticId} className='border-t'>
								<td className='px-2 py-2'>{player.position}</td>
								<td className='px-2 py-2 whitespace-nowrap'>{player.name}</td>
								<td className='px-2 py-2'>{player.staticId}</td>
								<td className='px-2 py-2'>{player.captures}</td>
								<td className='px-2 py-2'>{average(player.damage)}</td>
								<td className='px-2 py-2'>{average(player.kills)}</td>
								<td className='px-2 py-2'>{player.mvp}</td>
							</tr>)}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}
