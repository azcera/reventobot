const { MessageFlags, ChannelType } = require("discord.js");
require("dotenv").config();
const { getComponents } = require("./createButtons");
const parentChannelId = process.env.PARENT_CHANNEL_ID;

async function createChannel(interactionOrGuild, { channelName, member }) {
  const guild = interactionOrGuild.guild || interactionOrGuild;
  const isInteraction = !!interactionOrGuild.reply;

  // 1. Ищем родительский текстовый канал на сервере
  const parentChannel =
    guild.channels.cache.get(parentChannelId) ||
    (await guild.channels.fetch(parentChannelId).catch(() => null));

  // Проверяем, существует ли канал и является ли он текстовым
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

  // 2. Создаем приватную ветку внутри этого канала
  const newThread = await parentChannel.threads.create({
    name: channelName,
    autoArchiveDuration: 1440, // Автоархивация через 24 часа неактивности
    type: ChannelType.GuildPrivateThread, // Приватный тип ветки
    reason: `Приватная ветка для ${member.user.tag}`,
  });

  // 3. ДОБАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
  // Добавляем ТОЛЬКО того человека, которому создают архив
  await newThread.members.add(member.id).catch(() => {});

  // 4. Отправляем приветственное сообщение
  await newThread
    .send({
      content: `<@${member.id}>, это твой личный канал-архив, куда ты можешь отправлять:
  
    **- Откаты с мероприятий
    - Откаты с каптов
    - Заявки на повышение
    - Задавать вопросы хай-составу**
    **Зачем отправлять откаты?**
  
    Это все нужно для получения TIER, который показывает уровень твоей игры в нашей семье. Ниже ты можешь увидеть кнопки с навигацией, которые помогут тебе быстро найти нужный контент.`,
      allowedMentions: { users: [member.id] },
      components: getComponents(),
    })
    .catch(() => {});

  // 5. Отвечаем на саму кнопку (если вызов был через интеракцию)
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
