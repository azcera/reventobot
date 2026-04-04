const { PermissionsBitField } = require("discord.js");
const { splitName } = require("../commands/utility/splitName");
const { adminRoles } = require("../config.json");
require("dotenv").config();
const { createChannel } = require("../commands/utility/createChannel");

module.exports = (client) => {
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      const guild = newMember.guild;
      const oldHasAdmin = oldMember.roles.cache.filter((role) =>
        adminRoles.includes(role.id),
      );
      const newHasAdmin = newMember.roles.cache.filter((role) =>
        adminRoles.includes(role.id),
      );
      const addedRole = newHasAdmin.find((role) => !oldHasAdmin.has(role.id));
      const removedRole = oldHasAdmin.find((role) => !newHasAdmin.has(role.id));

      const memberNickname = newMember.displayName;
      const splittedData = splitName(memberNickname);
      if (!splittedData) return;

      const channelName = `archive-${splittedData.name}-${splittedData.stat}`;
      let existingChannel = guild.channels.cache.find(
        (c) => c.name === channelName,
      );

      const basePermissions = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ];

      if (addedRole) {
        if (!existingChannel) {
          existingChannel = await createChannel(guild, {
            channelName,
            member: newMember,
          });
        }
        await existingChannel.permissionOverwrites.set([
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: newMember.id, allow: basePermissions },
          { id: adminRoles[0], allow: basePermissions },
          { id: process.env.TIER_CHECKER_ROLE_ID, allow: basePermissions },
        ]);

        if (
          addedRole.id === adminRoles[0] &&
          !memberNickname.startsWith("[★]")
        ) {
          await newMember.setNickname(`[★] ${memberNickname}`).catch(() => {});
        } else if (
          adminRoles.slice(1, 3).includes(addedRole.id) &&
          !memberNickname.startsWith("[☆]")
        ) {
          await newMember.setNickname(`[☆] ${memberNickname}`).catch(() => {});
        }
      }

      if (removedRole) {
        if (!existingChannel) {
          existingChannel = await createChannel(guild, {
            channelName,
            member: newMember,
          });
        } else {
          await existingChannel.permissionOverwrites.set([
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: newMember.id, allow: basePermissions },
            ...adminRoles.map((id) => ({ id, allow: basePermissions })),
          ]);
        }

        if (memberNickname.includes("[") || memberNickname.includes("]")) {
          const cleanNickname = memberNickname.replace(/\[.*\]/g, "").trim();
          await newMember.setNickname(cleanNickname).catch(() => {});
        }
      }
    } catch (err) {
      console.error("Ошибка в onMakeAdmin", err);
    }
  });
};
