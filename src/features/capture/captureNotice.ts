export interface CaptureNotice {
	attack: boolean
	enemy: string
	startTime: string
	zone: string
	server?: string
}

export function captureNoticeKey(notice: CaptureNotice) {
	const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
	const start = normalize(notice.startTime)
	const enemy = normalize(notice.enemy)
	const zone = normalize(notice.zone)
	if (!/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}(:\d{2})?$/.test(start)) return
	if (!enemy || enemy === 'неизвестно' || !zone || zone === 'не указано') return
	return JSON.stringify([
		normalize(notice.server ?? ''),
		notice.attack,
		enemy,
		start.length === 16 ? start + ':00' : start,
		zone
	])
}
