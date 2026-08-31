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
        .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("group")
        .setLabel("ГРУПП")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("capt")
        .setLabel("КАПТ")
        .setStyle(ButtonStyle.Danger),
    );

    await message.channel.send({
      content: `# Панель управления:\nДля взаимодействия с ботом используйте кнопки ниже.\n\nКнопка \`"ГРУПП"\` — создает оповещение в канал пингов.\nКнопка \`"КАПТ"\` — создает регу на капт.\n\nВремя необходимо указывать по МСК. Формат \`ДД.ММ.ГГГГ ЧЧ:ММ\` нужен только если дата не сегодняшняя.`,
      components: [row],
    });

    return await message.delete().catch(() => {});
  },
};
