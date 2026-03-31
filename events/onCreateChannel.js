const { sendArchiveMessage } = require("../commands/utility/archiveMessage");
require("dotenv").config();

module.exports = (client) => {
  client.on("channelCreate", async (channel) => {
    if (channel.isTextBased()) {
      if (channel.parentId !== process.env.CATEGORY_ID) return;
      sendArchiveMessage(channel);
    }
  });
};
