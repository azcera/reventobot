const { messagesLinks } = require("../config.json");
const { getComponents } = require("./utility/createButtons");

async function editMessageByLink(client, messageLink) {
  try {
    const ids = messageLink.match(/\d+/g);
    if (!ids || ids.length < 3) return console.log("Неверная ссылка");

    const [guildId, channelId, messageId] = ids;

    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);

    await message.edit({
      components: getComponents(),
    });
  } catch (error) {
    console.error("Ошибка при редактировании:", error.message);
  }
}

async function editAllMessages(client) {
  try {
    for (const link of messagesLinks) {
      await editMessageByLink(client, link);
    }
    console.log("Сообщения успешно обновлено!");
  } catch {
    console.error("Ошибка при редактировании:", error.message);
  }
}

module.exports = {
  name: "update",
  description: "Обновляет меню",
  async execute(message, args) {
    await message
      .delete()
      .catch((err) => console.log("Не удалось удалить сообщение:", err));
    await editAllMessages(message.client);
  },
};
