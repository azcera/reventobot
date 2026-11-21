export const shapes = ['circle', 'rectangle', 'triangle', 'arrow'] as const
export const brushWidths = [3, 6, 12] as const
export type Shape = typeof shapes[number]
export type Point = [number, number]
export type Stroke = {
	type: 'stroke'
	id: string
	color: string
	width: number
	points: Point[]
}
export type BoardObject = Stroke
	| { type: 'shape'; id: string; shape: Shape; at: Point; color: string }
	| { type: 'player'; id: string; userId: string; at: Point; label: string }
export type MapInfo = { id: string; name: string; width: number; height: number; archived: boolean }
export type MapPage = { maps: MapInfo[]; next: string | null }
export type Player = { id: string; name: string }
export type TacticInfo = { id: string; name: string }
export type Board = {
	map: MapInfo | null
	epoch: number
	revision: number
	dirty: boolean
	objects: BoardObject[]
}
export type Edit =
	| { type: 'stroke'; id: string; color: string; width: number; point: Point }
	| { type: 'points'; id: string; points: Point[] }
	| { type: 'shape'; id: string; shape: Shape; color: string; at: Point }
	| { type: 'player'; id: string; userId: string; at: Point }
	| { type: 'move'; id: string; at: Point }
	| { type: 'remove'; id: string }
export type BoardChange =
	| { type: 'put'; object: BoardObject }
	| { type: 'points'; id: string; points: Point[] }
	| { type: 'remove'; id: string }
export type ClientMessage =
	| ({ epoch: number } & Edit)
	| { type: 'map' | 'load'; id: string; revision: number }
	| { type: 'save'; name: string; revision: number }
	| { type: 'sync' }
export type ServerMessage =
	| { type: 'snapshot'; board: Board; players: Player[]; canEdit: boolean }
	| { type: 'access'; canEdit: boolean }
	| { type: 'players'; players: Player[] }
	| { type: 'change'; change: BoardChange; revision: number; epoch: number }
	| { type: 'saved'; revision: number; mapId: string; tactic: TacticInfo }
	| { type: 'error'; message: string }
