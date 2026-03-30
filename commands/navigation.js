const { SlashCommandBuilder, roleMention } = require("discord.js");
const { getComponents } = require("./utility/createButtons");
require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("navigation")
    .setDescription("Создает навигацию"),
  async execute(interaction) {
    await interaction.reply({
      content: `||${roleMention(process.env.MENTIONED_ROLE)}||`,
      allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
      components: getComponents(),
    });
  },
};
