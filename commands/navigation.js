const { roleMention } = require("discord.js");
const { getComponents } = require("./utility/createButtons");
require("dotenv").config();

module.exports = {
  name: "navigation", // имя команды
  description: "Создает навигацию",
  async execute(message, args) {
    // теперь принимает message и args
    await message.channel.send({
      content: `||${roleMention(process.env.MENTIONED_ROLE)}||`,
      allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
      components: getComponents(),
    });
  },
};
