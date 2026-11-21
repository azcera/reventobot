import { brushWidths, shapes } from '../../../shared/tactics'
import type { Board, BoardChange, BoardObject, MapInfo, Player, Point, Shape } from '../../../shared/tactics'

export const uuid = (value: unknown): value is string =>
	typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(value)

function point(value: unknown): value is Point {
	return Array.isArray(value) && value.length === 2 &&
		value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
}

function color(value: unknown): value is string {
	return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
}

export class TacticsBoard {
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

	reset(map: MapInfo, objects: BoardObject[] = []) {
		this.map = map
		this.epoch++
		this.revision++
		this.dirty = false
		this.objects.clear()
		this.strokeOwners.clear()
		this.pointCount = 0
		for (const object of objects) {
			this.objects.set(object.id, object)
			if (object.type === 'stroke') this.pointCount += object.points.length
		}
	}

	edit(input: Record<string, unknown>, userId: string, players: Player[]): BoardChange {
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
			return this.put({ ...existing, at })
		if (type === 'points' && existing?.type === 'stroke' && this.strokeOwners.get(id) === userId) {
			const { points } = input
			if (!Array.isArray(points) || !points.length || points.length > 64 || !points.every(point))
				throw new Error('Некорректные точки штриха.')
			this.addPoints(points.length)
			existing.points.push(...points)
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
		if (type === 'player' && point(at)) {
			const player = players.find(item => item.id === input.userId)
			if (player) return this.put({ type, id, at, userId: player.id, label: player.name })
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

