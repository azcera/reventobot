const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { splitName } = require("./utility/splitName");
const { createChannel } = require("./utility/createChannel");
require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pack")
    .setDescription("Создает архивный канал для пользователя.")
    .addUserOption((option) =>
      option
        .setName("пользователь")
        .setDescription("Пользователь, для которого будет создан архив")
        .setRequired(true),
    ),
  async execute(interaction) {
    const member = interaction.options.getMember("пользователь");
    const displayName = member.displayName;

    const splittedData = splitName(displayName);
    if (splittedData === null) {
      await interaction.reply(
        `У пользователя <@${member.id}> ник не по форме.`,
      );
    } else {
      const guild = interaction.guild;
      const channels = guild.channels.cache;
      const channelName = `archive-${splittedData.name}-${splittedData.stat}`;
      let channelID = null;
      const existingChannel = channels.find((channel) => {
        if (channel.name === channelName) {
          channelID = channel;
          return true;
        }
        return false;
      });
      if (!existingChannel) {
        await createChannel(interaction, {
          channelName,
          member,
        });
      } else {
        await interaction.reply({
          content: `Архив уже создан - ${channelID}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
