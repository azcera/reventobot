const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  roleMention,
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
      if (!hadRoleBefore && hasRoleNow) {
        // роль была добавлена
        if (addedRole.id === adminRoles[0])
          newMember.setNickname(`[★] ${memberNickname}`);
        if (addedRole.id === adminRoles[1] || addedRole.id === adminRoles[2])
          newMember.setNickname(`[☆] ${memberNickname}`);
      }
      if (!hasRoleNow && hadRoleBefore) {
        const newNickname = memberNickname.replace(/\[.*\]/g, "").trim();
        newMember.setNickname(newNickname);
      }
    } catch (err) {
      console.error("Ошибка при изменении ника:", err);
    }
  });
};
