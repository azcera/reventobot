const edits = new Map<string, Promise<unknown>>()

export function enqueueCaptureEdit<T>(
	messageId: string,
	edit: () => Promise<T>
) {
	const previous = edits.get(messageId) ?? Promise.resolve()
	const pending = previous
		.catch(() => {})
		.then(edit)
		.finally(() => {
			if (edits.get(messageId) === pending) edits.delete(messageId)
		})
	edits.set(messageId, pending)
	return pending
}
