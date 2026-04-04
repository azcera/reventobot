const { MessageFlags, PermissionsBitField } = require("discord.js");
const { adminRoles } = require("../../config.json");
require("dotenv").config();

async function createChannel(interaction, { channelName, member }) {
  const permissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
  ];
  const newChannel = await guild.channels.create({
    name: channelName,
    type: 0,
    parent: process.env.CATEGORY_ID,
    permissionOverwrites: [
      {
        id: member.guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: member,
        allow: permissions,
      },
      {
        id: process.env.TIER_CHECKER_ROLE_ID,
        allow: permissions,
      },
      ...adminRoles
        .filter((roleId) => member.guild.roles.cache.has(roleId))
        .map((roleId) => ({
          id: roleId,
          allow: permissions,
        })),
    ],
  });
  await interaction.reply({
    content: `Архив для <@${member.id}> создан - ${newChannel}`,
    flags: MessageFlags.Ephemeral,
  });
  return newChannel;
}

module.exports = { createChannel };
