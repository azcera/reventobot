const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

/**
 * Сборка ContainerBuilder на основе элементов с веб-сайта
 * @param {Object} data - Данные запроса { noColor, accentColor, items }
 * @returns {Object} Payload для отправки в Discord channel.send()
 */
function buildWebContainer(data) {
  const { noColor, accentColor, items } = data;
  const container = new ContainerBuilder();

  // Установка цвета боковой полосы
  if (!noColor) {
    container.setAccentColor(
      accentColor ? parseInt(accentColor.replace("#", "0x")) : 0x5865f2,
    );
  }

  // Парсинг элементов конструктора
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
        // Большой невидимый отступ
        sep.setSpacing(SeparatorSpacingSize.Large);
        sep.setDivider(false);
      } else {
        // Тонкая разделительная линия
        sep.setSpacing(SeparatorSpacingSize.Small);
        sep.setDivider(true);
      }
      container.addSeparatorComponents(sep);
    } else if (item.type === "section") {
      const section = new SectionBuilder();

      if (item.value) {
        section.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(item.value),
        );
      }

      // Ссылка-кнопка в правый край секции
      if (item.btnLabel && item.btnLink) {
        const button = new ButtonBuilder()
          .setLabel(item.btnLabel)
          .setURL(item.btnLink)
          .setStyle(ButtonStyle.Link);

        section.setPrimaryButtonAccessory(button);
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
