const { sendArchiveMessage } = require("../commands/utility/archiveMessage");
require("dotenv").config();

const categoryIds = process.env.CATEGORY_IDS
  ? process.env.CATEGORY_IDS.split(",").map((id) => id.trim())
  : [];

module.exports = (client) => {
  client.on("channelCreate", async (channel) => {
    if (channel.isTextBased()) {
      if (!categoryIds.includes(channel.parentId)) return;
      await sendArchiveMessage(channel);
    }
  });
};
