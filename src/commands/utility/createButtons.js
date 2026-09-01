const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { navigationButttons } = require("../../../config.json");

function getComponents() {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  navigationButttons.forEach((btn, index) => {
    const button = new ButtonBuilder()
      .setLabel(btn.label)
      .setStyle(ButtonStyle.Link)
      .setURL(btn.link);

    currentRow.addComponents(button);

    if (
      currentRow.components.length === 4 ||
      index === navigationButttons.length - 1
    ) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });

  return rows.filter((row) => row.components.length > 0);
}

module.exports = { getComponents };
