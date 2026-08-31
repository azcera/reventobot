const { SlashCommandBuilder } = require("discord.js");
const { marketPrices } = require("../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("calc")
    .setDescription("Считает сумму выплаты за маркет.")
    .addIntegerOption((o) =>
      o.setName("спеш").setDescription("Количество спеш"),
    )
    .addIntegerOption((o) => o.setName("тяга").setDescription("Количество тяг"))
    .addIntegerOption((o) =>
      o.setName("пулик").setDescription("Количество пуликов"),
    )
    .addIntegerOption((o) =>
      o.setName("моды").setDescription("Количество модов"),
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

    const parts = [];
    if (spec > 0) parts.push(`${spec} спеш`);
    if (tyag > 0) parts.push(`${tyag} тяг`);
    if (pulik > 0) parts.push(`${pulik} пуликов`);
    if (mod > 0) parts.push(`${mod} модов`);

    const finalMessage =
      parts.length > 0
        ? `Выплата за ${parts.join(", ")}: **${result}**`
        : `Выплата: **${result}**`;

    await interaction.reply({ content: finalMessage });
  },
};
