const { navigationButttons, messagesLinks } = require("./config.json");

async function editMessageByLink(client, messageLink) {
  try {
    const ids = messageLink.match(/\d+/g);
    if (!ids || ids.length < 3) return console.log("Неверная ссылка");

    const [guildId, channelId, messageId] = ids;

    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);

    await message.edit({
      components: navigationButttons,
    });
  } catch (error) {
    console.error("Ошибка при редактировании:", error.message);
  }
}

async function editAllMessages(client) {
  try {
    messagesLinks.map(async (link) => await editMessageByLink(client, link));
    console.log("Сообщения успешно обновлено!");
  } catch {
    console.error("Ошибка при редактировании:", error.message);
  }
}

module.exports = { editAllMessages };
