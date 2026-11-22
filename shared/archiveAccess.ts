export type ArchiveAccessStatus = {
	state: 'off' | 'queued' | 'running' | 'complete' | 'failed'
	checked: number
	total: number
	changed: number
	issues: { threadId?: string; message: string }[]
}
