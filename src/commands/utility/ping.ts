/**
 * Префиксная команда !ping.
 * Отправляет «Ping ...», измеряет latency по createdTimestamp и редактирует сообщение.
 * @param {Message} message
 * @param {string[]} args
 */
export = {
	name: 'ping',
	description: 'Пингует бота',
	async execute(message: import('discord.js').Message<true>, args: string[]) {
		const sent = await message.channel.send('Ping ...')
		const latency = sent.createdTimestamp - message.createdTimestamp
		await message
			.delete()
			.catch(err => console.log('Не удалось удалить сообщение:', err))
		return await sent.edit(`Ping ${latency}`)
	}
}
