const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");

module.exports = {
  name: "adminbuttons",
  description: "Создает кнопки админ-панели",
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message
        .reply("У вас нет прав для использования этой команды!")
        .then((msg) => {
          setTimeout(() => msg.delete().catch(console.error), 5000);
        });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`create_group`)
        .setLabel("Создать групп")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`create_capt`)
        .setLabel("Создать набор")
        .setStyle(ButtonStyle.Danger),
    );
    await message.channel.send({
      content: "Панель управления:",
      components: [row],
    });
    return await message
      .delete()
      .catch((err) => console.log("Не удалось удалить сообщение:", err));
  },
};
