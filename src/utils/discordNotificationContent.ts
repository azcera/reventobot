interface NotificationComponent { type?: number; content?: string; data?: NotificationComponent; components?: NotificationComponent[]; items?: unknown[] }

function attachmentLabel(file: { contentType?: string | null; name?: string | null; url?: string }) {
	const type = file.contentType || ''
	const name = (file.name || file.url || '').split('?')[0]
	if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return '[Изображение]'
	if (type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) return '[Видео]'
	if (type.startsWith('audio/') || /\.(mp3|ogg|wav|flac|m4a|aac)$/i.test(name)) return '[Аудио]'
	return '[Файл]'
}

function discordNotificationContent(message: import('discord.js').Message) {
	const componentText = (components?: NotificationComponent[]): (string | undefined)[] => (components || []).flatMap(component => {
		const data = component.data || component
		return [
			component.content || data.content,
			...(data.type === 12 ? (data.items || []).map(() => '[Изображение]') : []),
			...(data.type === 13 ? ['[Файл]'] : []),
			...componentText(component.components || data.components)
		]
	}).filter(Boolean)
	const embeds = (message.embeds || []).flatMap(embed => {
		const image = embed.image || embed.data.type === 'image'
		const video = embed.video || embed.data.type === 'video' || embed.data.type === 'gifv'
		return [
			embed.title, embed.description, !image && !video ? embed.url : null,
			...(embed.fields || []).map(field => `${field.name}\n${field.value}`),
			image ? '[Изображение]' : null, video ? '[Видео]' : null, embed.footer?.text
		]
	}).filter(Boolean)
	return [
		message.content, ...embeds, ...componentText(message.components),
		...[...(message.attachments?.values() || [])].map(attachmentLabel),
		message.poll ? '[Опрос]' : null,
		...[...(message.stickers?.values() || [])].map(() => '[Стикер]')
	].filter(Boolean).join('\n').replace(/<@([!&]?)(\d+)>/g, (mention, type, id) => {
		if (type === '&') {
			const role = message.guild?.roles?.cache.get(id) || message.mentions?.roles?.get(id)
			return role ? `@${role.name}` : mention
		}
		const member = message.guild?.members?.cache.get(id) || message.mentions?.members?.get(id)
		const user = message.mentions?.users?.get(id) || message.client?.users?.cache.get(id)
		const name = member?.displayName || user?.globalName || user?.username
		return name ? `@${name}` : mention
	}).replace(/\r\n?/g, '\n').trim()
}

export { discordNotificationContent }
