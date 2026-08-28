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
        .setLabel("ГРУПП")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`create_capt`)
        .setLabel("КАПТ")
        .setStyle(ButtonStyle.Danger),
    );

    await message.channel.send({
      content: `
# Панель управления:
Для взаимодействия с ботом используйте кнопки ниже.

Кнопка \`"ГРУПП"\` — создает оповещение в канал пингов о предстоящем сборе.
Кнопка \`"КАПТ"\` — создает регу на капт.

Время необходимо указывать с учетом часового пояса Москвы (то есть написанное вами время будет считаться Московским временем).
Указывать время в формате \`ДД.ММ.ГГГГ ЧЧ:ММ\` необходимо только если дата не сегодняшняя. Во всех остальных случаях достаточно указать только время в формате \`ЧЧ:ММ\`.
`,
      components: [row],
    });
    return await message
      .delete()
      .catch((err) => console.log("Не удалось удалить сообщение:", err));
  },
};
