const {
	Guild,
	ChannelType,
	ContainerBuilder,
	MessageFlags,
} = require("discord.js");
const { getArchivesLists } = require("./archivesList");
const { getUnansweredList } = require("./archiveUnansweredList");
require("dotenv").config();

const adminChannelId = process.env.ARCHIVE_SETTINGS_CHANNEL;

async function clearChannel(channel) {
	try {
		const fetched = await channel.messages.fetch({ limit: 20 });
		await channel.bulkDelete(fetched, true);
		console.log("Сообщения успешно удалены.");
	} catch (error) {
		console.error("Ошибка при очистке канала:", error);
	}
}

/**
 * Отправляет или изменяет сообщение в панель управления
 * Ищет сообщение по уникальному заголовку
 * @param {Guild} guild
 * @param {ContainerBuilder[]} containers
 */
async function listsSend(guild) {
	const adminChannel =
		guild.channels.cache.get(adminChannelId) ||
		(await guild.channels.fetch(adminChannelId));

	if (!adminChannel || adminChannel.type !== ChannelType.GuildText) {
		return console.error("❌ Неправильно настроен канал с панелью управления.");
	}

	await clearChannel(adminChannel);

	let containers = await getArchivesLists(guild);

	containers.push(await getUnansweredList(guild));
	for (const container in containers) {
		const messageData = {
			components: [container],
			flags: [MessageFlags.IsComponentsV2],
		};
		await adminChannel.send(messageData);
	}
}

module.exports = { listsSend };
