const {
  MessageFlags,
  PermissionFlagsBits,
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const path = require("path");

module.exports = {
  name: "invite",
  description: "Создает сообщение для invite",
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message
        .reply("У вас нет прав для использования этой команды!")
        .then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }
    const imagePath1 = path.join(__dirname, "..", "images", "invites.png");

    const localImage1 = new AttachmentBuilder(imagePath1, {
      name: "invites.png",
    });

    const imagePath2 = path.join(__dirname, "..", "images", "revento.png");

    const localImage2 = new AttachmentBuilder(imagePath2, {
      name: "revento.png",
    });

    const inviteImage = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL("attachment://invites.png")
        .setDescription("REVENTO"),
    );

    const reventoImage = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL("attachment://revento.png")
        .setDescription("REVENTO"),
    );

    const inviteButton = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '## 😎 Оставить заявку на вступление\nДля этого нажмите кнопку "Подать заявку" справа и заполните необходимые данные.',
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId("open_invite_modal")
          .setLabel("😎 Подать заявку")
          .setStyle(ButtonStyle.Primary),
      );

    const container = new ContainerBuilder()
      .addMediaGalleryComponents(inviteImage)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## 🥶 Немного о нас:"),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "Мы ставим большие амбиции, так-как Revento - это прежде всего семья, жаждущая побед. Перед нами стоит много преград и наша цель - их преодолеть. В составе адекватные ребята, которые также замотивированы на победу.",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## 🪙 От нас Вы получите:"),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "### • Опытный и отзывчивый старший состав, готовый делится опытом и помогать\n### • Семейный офис, большой склад на 16 тонн\n### • Богатый автопарк, вертолеты\n### • Много интересного контента - капты, рп-контент, контракты\n### • Зафулл на все семейные мероприятия",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## ✅ Минимальные требования:"),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "### 1. Возраст 16+ (бывают исключения).\n### 2. Наличие рабочего микрофона и Discord.\n### 3. Знание базовых правил сервера (DM, PG, NRD).\n### 4. Адекватность и готовность участвовать в жизни семьи.",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addMediaGalleryComponents(reventoImage)
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## 📃 Форма заявки:"),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "### Никнейм без фамилии по форме (Имя | Статик)\n||Пример: Tony | 132961||\n### Возраст (ООС)\n||Пример: 18||\n### Как узнали о семье, чем заинтересовала?\n||Пример: узнал через маркет, вижу часто||\n### Где ранее играли (проекты, серверы, семьи)?\n||Пример: Revento, Sweet (maj), Gucci (5rp)||\n### Чего ждете от семьи, чем хотите заниматься?\n||Пример: хочу тулиться, развиваться||",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "## ❌ Ваша заявка будет отклонена, если:",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "```css\n1. Поля будут заполнены некорректно\n2. Форма подачи заявки будет не соблюдена\n3. В заявке присутствует обман в любом виде\n4. На момент принятия заявки ваш никнейм не будет соответствовать форме (Имя | Статик)```",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "Чем больше информации вы предоставите в заявке - тем больше шансов на ее одобрение.",
        ),
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
      )
      .addSectionComponents(inviteButton);
    await message.channel.send({
      flags: [MessageFlags.IsComponentsV2],
      components: [container],
      files: [localImage1, localImage2],
    });

    return await message.delete().catch(() => {});
  },
};
