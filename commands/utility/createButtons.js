const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { navigationButttons } = require("../../config.json");

function getComponents() {
  let components = [];
  let j = 0;
  row = [];
  for (let i = 0; i < navigationButttons.length; i++) {
    if (j === 4) {
      j = 0;
      components = [...components, new ActionRowBuilder().addComponents(row)];
      row = [];
    }
    row = [
      ...row,
      new ButtonBuilder()
        .setLabel(navigationButttons[i].label)
        .setStyle(ButtonStyle.Link)
        .setURL(navigationButttons[i].link),
    ];
    j++;
  }
  if (row.length > 0) {
    components = [...components, new ActionRowBuilder().addComponents(row)];
  }
  return components;
}

module.exports = {
  getComponents,
};
