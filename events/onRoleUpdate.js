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

handleMakeAdmin = async (oldMember, newMember, channelName) => {
  const oldHasAdmin = oldMember.roles.cache.filter((role) =>
    adminRoles.includes(role.id),
  );
  const newHasAdmin = newMember.roles.cache.filter((role) =>
    adminRoles.includes(role.id),
  );
  const addedRole = newHasAdmin.find((role) => !oldHasAdmin.has(role.id));
  const removedRole = oldHasAdmin.find((role) => !newHasAdmin.has(role.id));

  if (!addedRole && !removedRole) return;

  const cleanName = newMember.displayName.replace(/^\[.*\]\s*/g, "").trim();

  let existingChannel = newMember.guild.channels.cache.find(
    (c) => c.name === channelName,
  );

  const basePermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
  ];

  if (!existingChannel) return console.log(`Архив для ${newMember} не создан.`);

  let newPrefix = "";

  const baseOverwrites = [
    { id: newMember.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: newMember.id, allow: basePermissions },
    { id: process.env.TIER_CHECKER_ROLE_ID, allow: basePermissions },
  ];

  const adminOverwrites = adminRoles.map((id) => ({
    id,
    allow: basePermissions,
  }));

  if (addedRole) {
    await existingChannel.permissionOverwrites.set([
      ...baseOverwrites,
      { id: adminRoles[0], allow: basePermissions },
    ]);
    if (addedRole.id === adminRoles[0]) {
      newPrefix = "[★] ";
    } else if (adminRoles.slice(1).includes(addedRole.id)) {
      newPrefix = "[☆] ";
    }
  } else if (removedRole) {
    await existingChannel.permissionOverwrites.set([
      ...baseOverwrites,
      ...adminOverwrites,
    ]);
  }

  const finalNickname = `${newPrefix}${cleanName}`.slice(0, 32);

  if (newMember.displayName !== finalNickname && newMember.manageable) {
    await newMember.setNickname(finalNickname);
  }
};

handleMakeRevento = async (oldMember, newMember, channelName) => {
  const hadRoleBefore = oldMember.roles.cache.has(process.env.AUTO_ROLE);
  const hasRoleNow = newMember.roles.cache.has(process.env.AUTO_ROLE);

  if (!hadRoleBefore && hasRoleNow) {
    const channels = newMember.guild.channels.cache;

    let existingChannel = channels.find(
      (channel) => channel.name === channelName,
    );

    if (!existingChannel) {
      const messagesChannel = newMember.guild.channels.cache.get(
        process.env.MESSAGES_CHANNEL_ID,
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`create_${channelName}-${newMember.id}`)
          .setLabel("Да")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cancel_create_${channelName}-${newMember.id}`)
          .setLabel("Нет")
          .setStyle(ButtonStyle.Danger),
      );

      if (messagesChannel && messagesChannel.isTextBased()) {
        messagesChannel.send({
          content: `${adminRoles.map((e) => roleMention(e))} Создать для <@${newMember.id}> архив - \`${channelName}\`?`,
          components: [row],
        });
      }
    }
  }
};

handleNameEdit = async (oldMember, newMember, channelName) => {
  if (oldMember.displayName === newMember.displayName) return;
  const channels = newMember.guild.channels.cache;
  const splittedData = splitName(newMember.displayName);
  if (!splittedData) return;

  const newMemberChannelName = `archive-${splittedData.name}-${splittedData.stat}`;

  let existingChannel = channels.find(
    (channel) => channel.name === channelName,
  );

  if (existingChannel) {
    if (existingChannel.name !== newMemberChannelName) {
      await existingChannel.setName(newMemberChannelName);
    }
  }
};

module.exports = (client) => {
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    const displayName = oldMember.displayName;
    const splittedData = splitName(displayName);
    if (!splittedData) return;

    const channelName = `archive-${splittedData.name}-${splittedData.stat}`;

    try {
      await handleMakeAdmin(oldMember, newMember, channelName);
    } catch (error) {
      console.error("Ошибка MakeAdmin: ", error);
    }

    try {
      await handleMakeRevento(oldMember, newMember, channelName);
    } catch (error) {
      console.error("Ошибка MakeRevento: ", error);
    }
    try {
      await handleNameEdit(oldMember, newMember, channelName);
    } catch (error) {
      console.error("Ошибка NameEdit: ", error);
    }
  });
};
