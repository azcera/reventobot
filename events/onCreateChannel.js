const { roleMention } = require("discord.js");
const { getComponents } = require("../commands/utility/createButtons");
require("dotenv").config();

module.exports = (client) => {
  client.on("channelCreate", async (channel) => {
    if (channel.isTextBased()) {
      await channel.send({
        content: `||${roleMention(process.env.MENTIONED_ROLE)}||`,
        allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
        components: getComponents(),
      });
    }
  });
};
