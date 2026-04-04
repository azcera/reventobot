const { sendArchiveMessage } = require("./utility/archiveMessage");

module.exports = {
  name: "narchive",
  description: "Создает навигацию для конкретного пользователя",
  async execute(message, args) {
    await message
      .delete()
      .catch((err) => console.log("Не удалось удалить сообщение:", err));
    console.log(`narchive вызвана пользователем ${message.author.tag}`);
    return await sendArchiveMessage(message.channel);
  },
};
