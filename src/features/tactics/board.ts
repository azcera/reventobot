import { brushWidths, defaultPlayerColor, moveObject, shapes } from '../../../shared/tactics'
import type { Board, BoardChange, BoardObject, MapInfo, Player, Point, Shape } from '../../../shared/tactics'

export const uuid = (value: unknown): value is string =>
	typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(value)

export function point(value: unknown): value is Point {
	return Array.isArray(value) && value.length === 2 &&
		value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
}

function color(value: unknown): value is string {
	return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}

export class TacticsBoard {
	private history: { userId: string; id: string; before?: BoardObject; after?: BoardObject; undone: boolean }[] = []
	private objects = new Map<string, BoardObject>()
	private strokeOwners = new Map<string, string>()
	private pointCount = 0
	map: MapInfo | null = null
	epoch = 0
	revision = 0
	dirty = false

	snapshot(): Board {
		return {
			map: this.map, epoch: this.epoch, revision: this.revision, dirty: this.dirty,
			objects: [...this.objects.values()]
		}
	}

	reset(map: MapInfo | null, objects: BoardObject[] = []) {
		this.map = map
		this.epoch++
		this.revision++
		this.dirty = false
		this.objects.clear()
		this.strokeOwners.clear()
		this.history = []
		this.pointCount = 0
		for (const object of objects) {
			this.objects.set(object.id, object)
			if (object.type === 'stroke') this.pointCount += object.points.length
		}
	}

	edit(input: Record<string, unknown>, userId: string, players: Player[]): BoardChange {
		const before = typeof input.id === 'string' ? this.objects.get(input.id) : undefined
		const change = this.applyEdit(input, userId, players)
		const id = change.type === 'put' ? change.object.id : change.id
		const after = this.objects.get(id)
		const stroke = change.type === 'points' && this.history.findLast(entry => !entry.undone && entry.after === before)
		if (stroke) stroke.after = after
		else {
			this.history = this.history.filter(entry => entry.userId !== userId || !entry.undone)
			this.history.push({ userId, id, before, after, undone: false })
			if (this.history.length > 100) this.history.shift()
		}
		return change
	}

	private historyEntry(userId: string, redo: boolean) {
		return redo ? this.history.find(entry => entry.userId === userId && entry.undone)
			: this.history.findLast(entry => entry.userId === userId && !entry.undone)
	}

	historyState(userId: string) {
		const undo = this.historyEntry(userId, false)
		const redo = this.historyEntry(userId, true)
		return { undo: !!undo && this.objects.get(undo.id) === undo.after,
			redo: !!redo && this.objects.get(redo.id) === redo.before }
	}

	replay(userId: string, redo: boolean, epoch: unknown): BoardChange {
		if (!this.map || epoch !== this.epoch) throw new Error('Доска обновилась. Повторите действие.')
		const entry = this.historyEntry(userId, redo)
		const current = entry && this.objects.get(entry.id)
		if (!entry || current !== (redo ? entry.before : entry.after))
			throw new Error('Действие недоступно: объект уже изменился.')
		const object = redo ? entry.after : entry.before
		const points = (value?: BoardObject) => value?.type === 'stroke' ? value.points.length : 0
		if (!current && object && this.objects.size >= 1000) throw new Error('Доска заполнена.')
		this.addPoints(points(object) - points(current))
		entry.undone = !redo
		this.strokeOwners.delete(entry.id)
		if (object) return this.put(object)
		this.objects.delete(entry.id)
		return this.changed({ type: 'remove', id: entry.id })
	}

	movable(id: string) {
		const object = this.objects.get(id)
		return !!object && object.type !== 'stroke'
	}

	private applyEdit(input: Record<string, unknown>, userId: string, players: Player[]): BoardChange {
		const { id, type, at } = input
		if (!this.map || input.epoch !== this.epoch) throw new Error('Доска обновилась. Повторите действие.')
		if (!uuid(id)) throw new Error('Некорректный объект.')
		const existing = this.objects.get(id)
		if (type === 'remove' && existing) {
			this.objects.delete(id)
			this.strokeOwners.delete(id)
			if (existing.type === 'stroke') this.pointCount -= existing.points.length
			return this.changed({ type, id })
		}
		if (type === 'move' && existing && existing.type !== 'stroke' && point(at))
			return this.put(moveObject(existing, at))
		if (type === 'playerColor' && existing?.type === 'player' && color(input.color))
			return this.put({ ...existing, color: input.color })
		if (type === 'points' && existing?.type === 'stroke' && this.strokeOwners.get(id) === userId) {
			const { points } = input
			if (!Array.isArray(points) || !points.length || points.length > 64 || !points.every(point))
				throw new Error('Некорректные точки штриха.')
			this.addPoints(points.length)
			this.objects.set(id, { ...existing, points: [...existing.points, ...points] })
			return this.changed({ type, id, points })
		}
		if (existing || this.objects.size >= 1000) throw new Error('Объект уже существует или доска заполнена.')
		if (type === 'stroke' && color(input.color) && point(input.point) &&
			brushWidths.some(width => width === input.width)) {
			this.addPoints(1)
			this.strokeOwners.set(id, userId)
			return this.put({ type, id, color: input.color, width: Number(input.width), points: [input.point] })
		}
		if (type === 'shape' && color(input.color) && point(at) && shapes.includes(input.shape as Shape))
			return this.put({ type, id, at, color: input.color, shape: input.shape as Shape })
		if (type === 'arrow' && color(input.color) && point(at) && point(input.to) &&
			(at[0] !== input.to[0] || at[1] !== input.to[1]) && brushWidths.some(width => width === input.width))
			return this.put({ type, id, at, to: input.to, color: input.color, width: Number(input.width) })
		if (type === 'player' && point(at) && (input.color === undefined || color(input.color))) {
			const player = players.find(item => item.id === input.userId)
			if (player) return this.put({ type, id, at, userId: player.id, label: player.name, color: input.color ?? defaultPlayerColor })
		}
		throw new Error('Некорректное действие или участник покинул канал.')
	}

	private addPoints(count: number) {
		if (this.pointCount + count > 40000) throw new Error('Доска заполнена. Удалите часть штрихов.')
		this.pointCount += count
	}

	private put(object: BoardObject): BoardChange {
		this.objects.set(object.id, object)
		return this.changed({ type: 'put', object })
	}

	private changed(change: BoardChange) {
		this.revision++
		this.dirty = true
		return change
	}
}

