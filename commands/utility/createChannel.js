const { MessageFlags, ChannelType } = require("discord.js");
const { adminRoles } = require("../../config.json");
require("dotenv").config();

const parentChannelId = process.env.PARENT_CHANNEL_ID;

async function createChannel(interactionOrGuild, { channelName, member }) {
  const guild = interactionOrGuild.guild || interactionOrGuild;
  const isInteraction = !!interactionOrGuild.reply;

  const parentChannel =
    guild.channels.cache.get(parentChannelId) ||
    (await guild.channels.fetch(parentChannelId).catch(() => null));

  if (!parentChannel || parentChannel.type !== ChannelType.GuildText) {
    if (isInteraction) {
      await interactionOrGuild
        .reply({
          content:
            "Ошибка: родительский канал для веток не найден или настроен неверно.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    throw new Error(
      "Не удалось найти текстовый канал PARENT_CHANNEL_ID для создания ветки.",
    );
  }

  const newThread = await parentChannel.threads.create({
    name: channelName,
    autoArchiveDuration: 1440,
    type: ChannelType.GuildPrivateThread,
    reason: `Приватная ветка для ${member.user.tag}`,
  });

  // 1. Добавляем пользователя, для которого создается ветка
  await newThread.members.add(member.id).catch(() => {});

  // Принудительно запрашиваем участников сервера из API Discord, чтобы кэш ролей заполнился гарантированно
  await guild.members.fetch().catch(() => {});

  // 2. Добавляем роль проверки (TIER_CHECKER_ROLE_ID)
  if (process.env.TIER_CHECKER_ROLE_ID) {
    const tierRole = guild.roles.cache.get(process.env.TIER_CHECKER_ROLE_ID);
    if (tierRole) {
      // Теперь tierRole.members точно не будет пустой
      for (const [memberId] of tierRole.members) {
        await newThread.members.add(memberId).catch(() => {});
      }
    }
  }

  // 3. Добавляем администраторов из config.json
  for (const roleId of adminRoles) {
    const adminRole = guild.roles.cache.get(roleId);
    if (adminRole) {
      for (const [memberId] of adminRole.members) {
        await newThread.members.add(memberId).catch(() => {});
      }
    }
  }

  await newThread
    .send({
      content: `Привет <@${member.id}>! Твой приватный архив создан.`,
    })
    .catch(() => {});

  if (isInteraction) {
    await interactionOrGuild
      .reply({
        content: `Приватная ветка создана успешно — ${newThread}`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }

  return newThread;
}

module.exports = { createChannel };
