const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { navigationButttons } = require("../../config.json");

function getComponents() {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  navigationButttons.forEach((btn, index) => {
    // Создаем кнопку-ссылку
    const button = new ButtonBuilder()
      .setLabel(btn.label)
      .setStyle(ButtonStyle.Link)
      .setURL(btn.link);

    // Добавляем в текущую строку
    currentRow.addComponents(button);

    // Условие: если в строке 4 кнопки ИЛИ это самая последняя кнопка в массиве
    if (
      currentRow.components.length === 4 ||
      index === navigationButttons.length - 1
    ) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder(); // Подготавливаем новую строку
    }
  });

  // Возвращаем массив из ActionRow (для 9 кнопок это будет 4 + 4 + 1)
  return rows.filter((row) => row.components.length > 0);
}

module.exports = { getComponents };
