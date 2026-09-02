const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MediaGalleryBuilder, // Добавлено для изображений v2
  MediaGalleryItemBuilder, // Добавлено для изображений v2
  MessageFlags,
} = require("discord.js");

function buildWebContainer(data) {
  const { noColor, accentColor, items } = data;
  const container = new ContainerBuilder();

  if (!noColor) {
    container.setAccentColor(
      accentColor ? parseInt(accentColor.replace("#", "0x")) : 0x5865f2,
    );
  }

  for (const item of items) {
    if (item.type === "text") {
      if (item.value) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(item.value),
        );
      }
    } else if (item.type === "separator") {
      const sep = new SeparatorBuilder();
      if (item.large) {
        sep.setSpacing(SeparatorSpacingSize.Large);
        sep.setDivider(false); // Делаем прозрачный отступ без линии
      } else {
        sep.setSpacing(SeparatorSpacingSize.Small);
        sep.setDivider(true); // Обычный тонкий разделитель
      }
      container.addSeparatorComponents(sep);
    } else if (item.type === "image") {
      // ОБРАБОТКА ИЗОБРАЖЕНИЙ ПО URL ССЫЛКЕ
      if (item.value) {
        const mediaItem = new MediaGalleryItemBuilder().setURL(item.value);
        const gallery = new MediaGalleryBuilder().addItems(mediaItem);
        container.addMediaGalleryComponents(gallery);
      }
    } else if (item.type === "section") {
      const section = new SectionBuilder();

      if (item.value) {
        section.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(item.value),
        );
      }

      if (item.btnLabel && item.btnLink) {
        const button = new ButtonBuilder()
          .setLabel(item.btnLabel)
          .setURL(item.btnLink)
          .setStyle(ButtonStyle.Link);

        section.setButtonAccessory(button);
      }

      container.addSectionComponents(section);
    }
  }

  return {
    flags: [MessageFlags.IsComponentsV2],
    components: [container],
  };
}

module.exports = { buildWebContainer };
