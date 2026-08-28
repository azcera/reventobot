const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  roleMention,
} = require("discord.js");
const { splitName } = require("../commands/utility/splitName");
const { adminRoles } = require("../config.json");
require("dotenv").config();

let handleMakeAdmin = async (oldMember, newMember) => {
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

  let newPrefix = "";

  if (addedRole) {
    if (addedRole.id === adminRoles[0]) {
      newPrefix = "[𝐃𝐞𝐩] "; // dep
    } else if (addedRole.id === adminRoles[1]) {
      newPrefix = "[𝐇𝐢𝐠𝐡] "; // high
    } else if (addedRole.id === adminRoles[2]) {
      newPrefix = "[𝐑𝐞𝐜] "; // recruit
    }
  }
  const finalNickname = `${newPrefix}${cleanName}`.slice(0, 32);

  if (newMember.displayName !== finalNickname && newMember.manageable) {
    await newMember.setNickname(finalNickname);
  }
};

let handleMakeRevento = async (oldMember, newMember, channelName) => {
  const hadRoleBefore = oldMember.roles.cache.has(process.env.AUTO_ROLE);
  const hasRoleNow = newMember.roles.cache.has(process.env.AUTO_ROLE);
  let parsedChannelName = channelName.replace(/-/g, " ");

  if (!hadRoleBefore && hasRoleNow) {
    const channels = newMember.guild.channels.cache;

    let existingChannel = channels.find(
      (channel) => channel.name === parsedChannelName,
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

let handleNameEdit = async (oldMember, newMember, channelName) => {
  if (oldMember.displayName === newMember.displayName) return;
  const channels = newMember.guild.channels.cache;
  const splittedData = splitName(newMember.displayName);
  if (!splittedData) return;

  const newMemberChannelName = `archive ${splittedData.name} ${splittedData.stat}`;

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
      await handleMakeAdmin(oldMember, newMember);
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
