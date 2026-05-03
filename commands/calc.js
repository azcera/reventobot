const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { splitName } = require("./utility/splitName");
const { createChannel } = require("./utility/createChannel");
const { marketPrices } = require("../config.json");
module.exports = {
  data: new SlashCommandBuilder()
    .setName("calc")
    .setDescription("Считает сумму выплаты за маркет.")
    .addIntegerOption((option) =>
      option
        .setName("спеш")
        .setDescription("Количество спеш")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("тяга")
        .setDescription("Количество тяг")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("пулик")
        .setDescription("Количество пуликов")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("моды")
        .setDescription("Количество модов")
        .setRequired(false),
    ),
  async execute(interaction) {
    const spec = interaction.options.getInteger("спеш") || 0;
    const tyag = interaction.options.getInteger("тяга") || 0;
    const pulik = interaction.options.getInteger("пулик") || 0;
    const mod = interaction.options.getInteger("моды") || 0;

    const result =
      spec * marketPrices.spec +
      tyag * marketPrices.tyag +
      pulik * marketPrices.pulik +
      mod * marketPrices.mod;

    let messageParts = [];
    if (spec > 0) messageParts.push(`${spec} спеш`);
    if (tyag > 0) messageParts.push(`${tyag} тяг`);
    if (pulik > 0) messageParts.push(`${pulik} пуликов`);
    if (mod > 0) messageParts.push(`${mod} модов`);

    let finalMessage = "Выплата";
    if (messageParts.length > 0) {
      finalMessage += ` за ${messageParts.join(", ")}`;
    }
    finalMessage += `: **${result}**`;

    await interaction.reply({
      content: finalMessage,
    });
  },
};
