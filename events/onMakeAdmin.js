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

      if (!addedRole && !removedRole) return;

      const currentNickname = newMember.displayName;
      const cleanName = currentNickname.replace(/^\[.*\]\s*/g, "").trim();

      const splittedData = splitName(cleanName);
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

      if (!existingChannel) {
        existingChannel = await createChannel(guild, {
          channelName,
          member: newMember,
        });
      }
      if (addedRole) {
        await existingChannel.permissionOverwrites.set([
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: newMember.id, allow: basePermissions },
          { id: adminRoles[0], allow: basePermissions },
          { id: process.env.TIER_CHECKER_ROLE_ID, allow: basePermissions },
        ]);
      } else if (removedRole) {
        await existingChannel.permissionOverwrites.set([
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: newMember.id, allow: basePermissions },
          { id: process.env.TIER_CHECKER_ROLE_ID, allow: basePermissions },
          ...adminRoles.map((id) => ({ id, allow: basePermissions })),
        ]);
      }

      let newPrefix = "";

      if (newMember.roles.cache.has(adminRoles[0])) {
        newPrefix = "[★] ";
      } else if (
        newMember.roles.cache.some((id) => adminRoles.slice(1, 3).includes(id))
      ) {
        newPrefix = "[☆] ";
      }

      const finalNickname = `${newPrefix}${cleanName}`.slice(0, 32);

      if (newMember.displayName !== finalNickname) {
        await newMember
          .setNickname(finalNickname)
          .catch((err) => console.error("Ошибка смены ника:", err));
      }
    } catch (err) {
      console.error("Ошибка в onMakeAdmin", err);
    }
  });
};
