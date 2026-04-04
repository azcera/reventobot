const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  roleMention,
  PermissionsBitField,
} = require("discord.js");
const { splitName } = require("../commands/utility/splitName");
const { adminRoles } = require("../config.json");
require("dotenv").config();

module.exports = (client) => {
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      let addedRole = null;
      // Проверяем, была ли роль только что добавлена
      const hadRoleBefore = oldMember.roles.cache.some((role) => {
        if (adminRoles.includes(role.id)) {
          addedRole = role;
          return true;
        }
        return false;
      });
      const hasRoleNow = newMember.roles.cache.some((role) => {
        if (adminRoles.includes(role.id)) {
          addedRole = role;
          return true;
        }
        return false;
      });
      if (!addedRole) return;
      const memberNickname = newMember.displayName;
      const splittedData = splitName(memberNickname);
      if (!splittedData) return;
      const guild = newMember.guild;
      const channels = guild.channels.cache;
      const channelName = `archive-${splittedData.name}-${splittedData.stat}`;
      let memberArchive;
      const existingChannel = channels.find((channel) => {
        if (channel.name === channelName) {
          memberArchive = channel;
          return true;
        }
        return false;
      });

      // permission
      const permission = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ];

      const permissions = [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: process.env.TIER_CHECKER_ROLE_ID,
          allow: permission,
        },
        {
          id: member,
          allow: permission,
        },
        {
          id: adminRoles[0],
          allow: permission,
        },
      ];

      if (!hadRoleBefore && hasRoleNow) {
        if (!existingChannel) {
          await memberArchive.permissionOverwrites.set(permissions);
        } else {
          const newChannel = await createChannel(interaction, {
            channelName,
            member: newMember,
          });
          await newChannel.permissionOverwrites.set(permissions);
        }
        if (addedRole.id === adminRoles[0])
          newMember.setNickname(`[★] ${memberNickname}`);
        if (addedRole.id === adminRoles[1] || addedRole.id === adminRoles[2])
          newMember.setNickname(`[☆] ${memberNickname}`);
      }
      if (!hasRoleNow && hadRoleBefore) {
        if (!existingChannel) {
          await memberArchive.permissionOverwrites.set([
            {
              id: guild.roles.everyone.id,
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
          ]);
        } else {
          await createChannel(interaction, {
            channelName,
            member: newMember,
          });
        }
        const newNickname = memberNickname.replace(/\[.*\]/g, "").trim();
        newMember.setNickname(newNickname);
      }
    } catch (err) {
      console.error("Ошибка при изменении ника:", err);
    }
  });
};
