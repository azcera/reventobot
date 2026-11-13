import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { optionsMap } from '../features/capture/groupOptions'

// Время регулярных событий совпадает с формой создания группа.
const labels: Record<string, string> = { 'ДРОП': 'Дроп', 'ДИЛЕРЫ': 'Дилеры', 'ЦЕХА': 'Цеха', 'ТАЙНИКИ': 'Тайники' }
export = [
	...Object.entries(optionsMap).map(([id, event]) => ({ id, label: labels[event.target], time: event.time, days: [] })),
	{ id: 'supply', label: 'Поставки', time: '24/7', is247: true, days: [], note: 'Безопасный час 15:00–16:00' },
	{ id: 'contraband', label: 'Контрабанда', time: '24/7', is247: true, days: [], note: 'В 30 мин. каждого часа' },
	{ id: 'island', label: 'Остров', time: '16:00–19:00, 20:00–23:00', window: true, days: ['вт', 'чт', 'вс'] },
	{ id: 'fz', label: 'ФЗ', time: '16:00–19:00, 20:00–23:00', window: true, days: ['пн', 'ср', 'пт', 'сб'] },
	{ id: 'captures', label: 'Капты', time: '15:00–21:00', window: true, days: ['пн', 'ср', 'пт', 'сб'] }
]
