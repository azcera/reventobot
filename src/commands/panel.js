const {
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");

module.exports = {
  name: "panel",
  description: "Создает кнопки админ-панели",
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message
        .reply("У вас нет прав для использования этой команды!")
        .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }

    const titleText = new TextDisplayBuilder().setContent(
      "## 📌 Админ-панель\nДля взаимодействия с ботом используйте кнопки ниже.",
    );

    const groupSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "📢 ╎ **Отправить оповещение о группе**",
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId("group")
          .setLabel("📢 Создать групп")
          .setStyle(ButtonStyle.Primary),
      );
    const captSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("⚔️ ╎ **Создать регу на капт**"),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId("capt")
          .setLabel("⚔️ Создать капт")
          .setStyle(ButtonStyle.Danger),
      );

    const moveAllSection = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "🔊 ╎ **Переместить всех в один канал**",
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId("moveall")
          .setLabel("🔊 Выбрать канал")
          .setStyle(ButtonStyle.Secondary),
      );

    const footerText = new TextDisplayBuilder().setContent(
      "*Время необходимо указывать по МСК. Формат \`ДД.ММ.ГГГГ ЧЧ:ММ\` нужен только если дата не сегодняшняя.*",
    );

    const container = new ContainerBuilder()
      .addTextDisplayComponents(titleText)
      .addSeparatorComponents(new SeparatorBuilder())
      .addSectionComponents(groupSection)
      .addSeparatorComponents(new SeparatorBuilder())
      .addSectionComponents(captSection)
      .addSeparatorComponents(new SeparatorBuilder())
      .addSectionComponents(moveAllSection)
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(footerText);

    await message.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    });

    return await message.delete().catch(() => {});
  },
};
