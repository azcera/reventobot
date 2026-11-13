export function captureExpired(timestamp: string, now = Date.now()) {
	const seconds = /<t:(\d+)(?::[a-zA-Z])?>/.exec(timestamp)?.[1]
	return seconds !== undefined && now >= Number(seconds) * 1000 + 3600000
}
