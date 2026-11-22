export const shapes = ['circle', 'rectangle', 'triangle', 'arrow'] as const
export const brushWidths = [3, 6, 12] as const
export const defaultPlayerColor = '#ff414b'
export type Shape = typeof shapes[number]
export type Point = [number, number]
export type Stroke = {
	type: 'stroke'
	id: string
	color: string
	width: number
	points: Point[]
}
export type Arrow = { type: 'arrow'; id: string; at: Point; to: Point; color: string; width: number }
export type BoardObject = Stroke | Arrow
	| { type: 'shape'; id: string; shape: Shape; at: Point; color: string }
	| { type: 'player'; id: string; userId: string; at: Point; label: string; color?: string }
export type MapCategory = { id: string; name: string }
export type MapInfo = { id: string; name: string; width: number; height: number; categoryId: string }
export type CatalogMap = MapInfo & { tactics: TacticInfo[] }
export type MapCatalog = { categories: MapCategory[]; maps: CatalogMap[] }
export type MapOrder = { categoryId: string; previous: string[]; ids: string[] }
export type MapPage = { maps: MapInfo[]; next: string | null }
export type Player = { id: string; name: string }
export type EditorCursor = Player & { at: Point }
export type BoardAccess = { canEdit: boolean; isAdmin?: boolean; restricted?: boolean; moderation?: { id: string; restricted: boolean }[] }
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
	| Arrow
	| { type: 'player'; id: string; userId: string; at: Point; color: string }
	| { type: 'playerColor'; id: string; color: string }
	| { type: 'move'; id: string; at: Point }
	| { type: 'remove'; id: string }
export type BoardChange =
	| { type: 'put'; object: BoardObject }
	| { type: 'points'; id: string; points: Point[] }
	| { type: 'remove'; id: string }
export type ClientMessage =
	| ({ epoch: number; cursor?: Point } & Edit)
	| { type: 'undo' | 'redo'; epoch: number }
	| { type: 'drag'; epoch: number; id: string; at: Point | null; cursor?: Point }
	| { type: 'cursor'; epoch: number; at: Point }
	| { type: 'restrict'; userId: string; restricted: boolean }
	| { type: 'map' | 'load'; id: string; revision: number }
	| { type: 'save'; name: string; revision: number }
	| { type: 'sync' }
export type ServerMessage =
	| ({ type: 'snapshot'; board: Board; players: Player[]; selfId?: string; cursors?: EditorCursor[] } & BoardAccess)
	| ({ type: 'access' } & BoardAccess)
	| { type: 'players'; players: Player[] }
	| { type: 'history'; undo: boolean; redo: boolean }
	| { type: 'drag'; epoch: number; id: string; at: Point | null }
	| { type: 'cursor'; epoch: number; cursor: EditorCursor }
	| { type: 'catalog'; id: string; map: MapInfo | null; imageChanged?: boolean }
	| { type: 'tactics'; mapId: string }
	| { type: 'change'; change: BoardChange; revision: number; epoch: number }
	| { type: 'saved'; revision: number; mapId: string; tactic: TacticInfo }
	| { type: 'error'; message: string }

export function moveObject(object: Exclude<BoardObject, Stroke>, at: Point): typeof object {
	if (object.type !== 'arrow') return { ...object, at }
	const shift = (axis: 0 | 1) => Math.max(
		-Math.min(object.at[axis], object.to[axis]),
		Math.min(1 - Math.max(object.at[axis], object.to[axis]), at[axis] - object.at[axis])
	)
	const dx = shift(0)
	const dy = shift(1)
	return { ...object, at: [object.at[0] + dx, object.at[1] + dy], to: [object.to[0] + dx, object.to[1] + dy] }
}
