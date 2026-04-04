const { MessageFlags, PermissionsBitField } = require("discord.js");
const { adminRoles } = require("../../config.json");
require("dotenv").config();

async function createChannel(interactionOrGuild, { channelName, member }) {
  const guild = interactionOrGuild.guild || interactionOrGuild;
  const isInteraction = !!interactionOrGuild.reply;

  const permissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
  ];
  const isUserAdmin = member.roles.cache.some((role) =>
    adminRoles.includes(role.id),
  );
  const permissionsForAdmins = isUserAdmin
    ? [
        {
          id: adminRoles[0],
          allow: permissions,
        },
      ]
    : adminRoles.map((roleId) => ({
        id: roleId,
        allow: permissions,
      }));

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
        id: member.id,
        allow: permissions,
      },
      {
        id: process.env.TIER_CHECKER_ROLE_ID,
        allow: permissions,
      },
      ...permissionsForAdmins,
    ],
  });
  if (isInteraction) {
    await interactionOrGuild
      .reply({
        content: `Архив для <@${member.id}> создан - ${newChannel}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
  return newChannel;
}

module.exports = { createChannel };
