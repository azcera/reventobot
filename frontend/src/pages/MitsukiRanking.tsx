import { useEffect, useState } from 'react'
import type { Api, ApiRoutes } from '../types'
import { errorMessage } from '../types'

export function MitsukiRanking({ api }: { api: Api }) {
	const [open, setOpen] = useState(false)
	const [result, setResult] = useState<ApiRoutes['capture-ranking/mitsuki']>()
	const [error, setError] = useState('')
	useEffect(() => {
		if (!open) return
		let active = true
		setError('')
		void api('capture-ranking/mitsuki').then(
			data => { if (active) setResult(data) },
			caught => { if (active) setError(errorMessage(caught)) }
		)
		return () => { active = false }
	}, [api, open])
	const average = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

	return (
		<details className='border-t pt-4' onToggle={event => setOpen(event.currentTarget.open)}>
			<summary className='font-semibold'>Рейтинг Mitsuki за месяц</summary>
			{open && (error ? <p role='alert'>{error}</p> : !result ? (
				<p role='status'>Загружается рейтинг Mitsuki…</p>
			) : !result.ready || !result.players.length ? (
				<p role='status'>Рейтинг Mitsuki пока недоступен.</p>
			) : (
				<div className='mt-2 overflow-x-auto'>
					<p className='text-sm text-muted'>Игроки без оценки идут по K/D Mitsuki — киллам за капт.</p>
					<table className='w-full text-left text-sm'>
						<thead>
							<tr>
								{['Место', 'Игрок', 'Капты', 'Ср. урон', 'K/D Mitsuki', 'Победы', 'Рейтинг Mitsuki'].map(label =>
									<th key={label} scope='col' className='whitespace-nowrap px-2 py-2'>{label}</th>
								)}
							</tr>
						</thead>
						<tbody>
							{result.players.map(player => (
								<tr key={player.key} className='border-t'>
									<td className='px-2 py-2'>{player.position}</td>
									<td className='whitespace-nowrap px-2 py-2'>
										{player.name}{player.staticId && ` (${player.staticId})`}
									</td>
									<td className='px-2 py-2'>{player.captures}</td>
									<td className='px-2 py-2'>{average(player.avgDamage)}</td>
									<td className='px-2 py-2'>{average(player.avgKills)}</td>
									<td className='px-2 py-2'>{player.winrate}%</td>
									<td className='px-2 py-2'>{player.rating ?? '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}
		</details>
	)
}
