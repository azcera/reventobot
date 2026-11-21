import type { BoardObject, Point, Shape } from '../../../shared/tactics'

type Position = (point: Point) => Point
const size = 21

function traceShape(context: CanvasRenderingContext2D, shape: Shape, x: number, y: number) {
	if (shape === 'circle') context.arc(x, y, size, 0, Math.PI * 2)
	if (shape === 'rectangle') context.rect(x - size, y - size * .72, size * 2, size * 1.44)
	if (shape === 'triangle') {
		context.moveTo(x, y - size)
		context.lineTo(x + size, y + size)
		context.lineTo(x - size, y + size)
		context.closePath()
	}
	if (shape === 'arrow') {
		context.moveTo(x - size, y)
		context.lineTo(x + size, y)
		context.lineTo(x + size * .35, y - size * .55)
		context.moveTo(x + size, y)
		context.lineTo(x + size * .35, y + size * .55)
	}
}

export function paint(canvas: HTMLCanvasElement, objects: BoardObject[], selected: string | null) {
	const context = canvas.getContext('2d')
	if (!context) return
	const scale = Math.min(canvas.width, canvas.height) / 850
	const width = canvas.width / scale
	const height = canvas.height / scale
	const position: Position = ([x, y]) => [x * width, y * height]
	context.setTransform(scale, 0, 0, scale, 0, 0)
	context.clearRect(0, 0, width, height)
	context.lineCap = 'round'
	context.lineJoin = 'round'
	for (const object of objects) {
		context.save()
		if (object.id === selected) {
			context.shadowColor = '#ffffff'
			context.shadowBlur = 9 * scale
		}
		context.beginPath()
		if (object.type === 'stroke') {
			const [x, y] = position(object.points[0])
			context.lineWidth = object.width
			context.strokeStyle = object.color
			context.fillStyle = object.color
			if (object.points.length === 1) {
				context.arc(x, y, object.width / 2, 0, Math.PI * 2)
				context.fill()
			} else {
				context.moveTo(x, y)
				for (let i = 1; i < object.points.length; i++) context.lineTo(...position(object.points[i]))
				context.stroke()
			}
		} else {
			const [x, y] = position(object.at)
			if (object.type === 'shape') {
				context.lineWidth = 4
				context.strokeStyle = object.color
				context.fillStyle = `${object.color}38`
				traceShape(context, object.shape, x, y)
				if (object.shape !== 'arrow') context.fill()
				context.stroke()
			} else {
				context.font = '600 16px system-ui'
				context.textBaseline = 'middle'
				context.textAlign = 'center'
				const labelWidth = Math.min(300, context.measureText(object.label).width + 18)
				context.roundRect(x - labelWidth / 2, y - 14, labelWidth, 28, 6)
				context.fillStyle = '#101726'
				context.strokeStyle = '#5eead4'
				context.lineWidth = 2
				context.fill()
				context.stroke()
				context.fillStyle = '#ffffff'
				context.fillText(object.label, x, y, labelWidth - 12)
			}
		}
		context.restore()
	}
}

function distance([x, y]: Point, [ax, ay]: Point, [bx, by]: Point) {
	const dx = bx - ax
	const dy = by - ay
	const length = dx * dx + dy * dy
	const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0
	return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}

export function hit(objects: BoardObject[], point: Point, width: number, height: number) {
	const scale = Math.min(width, height) / 850
	const position: Position = ([x, y]) => [x * width / scale, y * height / scale]
	const target = position(point)
	for (let i = objects.length - 1; i >= 0; i--) {
		const object = objects[i]
		if (object.type === 'stroke') {
			if (object.points.some((p, j) =>
				distance(target, position(p), position(object.points[Math.max(0, j - 1)])) <= Math.max(8, object.width)))
				return object
		} else {
			const [x, y] = position(object.at)
			const toleranceX = object.type === 'player' ? Math.min(150, 12 + object.label.length * 5) : size + 4
			if (Math.abs(target[0] - x) <= toleranceX && Math.abs(target[1] - y) <= size + 4)
				return object
		}
	}
}
