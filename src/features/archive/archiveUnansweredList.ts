import {
	Guild,
	SeparatorBuilder,
	TextDisplayBuilder,
	type ThreadChannel
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import { loadDiscordMembers } from '../../services/discordMembers'
import { getError } from '../../utils/errors'
import { getArchiveOwners, getArchiveThreads, getLastArchiveAuthor } from './unusedArchives'
require('dotenv').config()

async function getUnansweredList(guild: Guild, threads?: Awaited<ReturnType<typeof getArchiveThreads>>, owners?: Map<string, string>) {
	const members = await loadDiscordMembers(guild)
	threads ??= await getArchiveThreads(guild)
	owners ??= await getArchiveOwners(guild, threads)
	const unansweredList: ThreadChannel[] = []
	const archives = [...threads.values()]
	for (let offset = 0; offset < archives.length; offset += 6) {
		await Promise.all(
			archives.slice(offset, offset + 6).map(async thread => {
				try {
					const ownerId = owners.get(thread.id)
					if (ownerId && members.has(ownerId) && await getLastArchiveAuthor(thread) === ownerId)
						unansweredList.push(thread)
				} catch (error) {
					console.error(
						`❌ Ошибка при обработке ветки ${thread.id}:`,
						getError(error).message
					)
				}
			})
		)
	}

	const build = (lines: string) =>
		dashboard.decorate(
			'unanswered',
			new ContainerBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(dashboard.text('unanswered.1'))
				)
				.addSeparatorComponents(new SeparatorBuilder())
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines))
		)
	if (!unansweredList.length) return [build(dashboard.text('unanswered.empty'))]
	unansweredList.sort(
		(a, b) =>
			Number(a.name.match(/(\d+)\s*$/)?.[1] ?? 0) -
			Number(b.name.match(/(\d+)\s*$/)?.[1] ?? 0)
	)

	const pages: ContainerBuilder[] = []
	const lines = unansweredList.map(
		(thread, index) => `${index + 1}. <#${thread.id}>`
	)
	let cursor = 0
	while (cursor < lines.length) {
		let end = Math.min(lines.length, cursor + 150)
		let page = build(lines.slice(cursor, end).join('\n'))
		for (;;) {
			try {
				page.toJSON()
				break
			} catch (error) {
				if (end <= cursor + 1) throw error
				end = cursor + Math.floor((end - cursor) / 2)
				page = build(lines.slice(cursor, end).join('\n'))
			}
		}
		pages.push(page)
		cursor = end
	}
	return pages
}

export { getUnansweredList }
