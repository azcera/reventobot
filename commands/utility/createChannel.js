const {
  MessageFlags,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");
const { adminRoles } = require("../../config.json");
require("dotenv").config();

const categoryIds = process.env.CATEGORY_IDS
  ? process.env.CATEGORY_IDS.split(",").map((id) => id.trim())
  : [];

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

  await guild.channels.fetch().catch(() => {});

  let availableCategoryId = null;
  for (const catId of categoryIds) {
    const category = guild.channels.cache.get(catId);
    if (!category || category.type !== ChannelType.GuildCategory) continue;

    const childrenCount = guild.channels.cache.filter(
      (ch) => ch.parentId === catId,
    ).size;

    if (childrenCount < 50) {
      availableCategoryId = catId;
      break;
    }
  }

  if (!availableCategoryId) {
    if (isInteraction) {
      await interactionOrGuild
        .reply({
          content:
            "Ошибка: все доступные категории переполнены или не найдены.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    throw new Error("Нет доступных категорий для создания канала.");
  }

  const newChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: availableCategoryId,
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
