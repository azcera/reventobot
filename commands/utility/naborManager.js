const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

// Хранилище активных наборов в памяти бота
// Ключ: ID сообщения набора, Значение: { time, mainList: [], reserveList: [], leftList: [] }
const activeNabors = new Map();

// Максимальное количество мест в основном списке
const MAX_MAIN_SEATS = 20;

/**
 * Функция создания красивого Embed с актуальными списками
 */
function createNaborEmbed(time, mainList, reserveList, leftList = []) {
  const embed = new EmbedBuilder()
    .setTitle("📢 Сбор на капт!")
    .setDescription(
      `**Время проведения:** ${time}\n\nНажимайте кнопки ниже, чтобы записаться или выписаться.`,
    )
    .setColor("#2f3136")
    .setTimestamp();

  // Формируем строку основного списка (он отображается всегда)
  let mainListText =
    mainList.length > 0
      ? mainList.map((id, index) => `${index + 1}. <@${id}>`).join("\n")
      : "_Список пуст_";

  embed.addFields({
    name: `👥 Основной состав (${mainList.length}/${MAX_MAIN_SEATS})`,
    value: mainListText,
    inline: false,
  });

  // Отображаем резерв только если он не пуст
  if (reserveList.length > 0) {
    let reserveListText = reserveList
      .map((id, index) => `${index + 1}. <@${id}>`)
      .join("\n");
    embed.addFields({
      name: `⏳ Резерв (${reserveList.length})`,
      value: reserveListText,
      inline: false,
    });
  }

  // Отображаем покинувших только если они есть
  if (leftList.length > 0) {
    let leftListText = leftList
      .map((id, index) => `${index + 1}. <@${id}>`)
      .join("\n");
    embed.addFields({
      name: `🚪 Покинули набор (${leftList.length})`,
      value: leftListText,
      inline: false,
    });
  }

  return embed;
}

/**
 * Создание кнопок для участников
 */
function createNaborButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("nabor_join")
      .setLabel("Присоединиться")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("nabor_leave")
      .setLabel("Выйти")
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Экспортируемые функции для основного хендлера
 */
module.exports = {
  // Функция для первичной отправки набора в канал
  async sendNabor(interaction, time) {
    const plusChannelId = process.env.PLUS_CHANNEL_ID;
    const mentionedRoleId = process.env.MENTIONED_ROLE; // Получаем ID роли из .env

    if (!plusChannelId) {
      return console.log("Ошибка: В файле .env не указан PLUS_CHANNEL_ID");
    }

    const channel =
      interaction.client.channels.cache.get(plusChannelId) ||
      (await interaction.client.channels
        .fetch(plusChannelId)
        .catch(() => null));

    if (!channel) {
      return console.log(`Ошибка: Канал с ID ${plusChannelId} не найден.`);
    }

    const embed = createNaborEmbed(time, [], [], []);
    const buttons = createNaborButtons();

    // Формируем упоминание роли, если ID указан в .env
    const roleMention = mentionedRoleId
      ? `<@&${mentionedRoleId}>`
      : "@everyone";

    // Отправляем эмбед вместе с упоминанием роли
    const msg = await channel.send({
      content: roleMention,
      embeds: [embed],
      components: [buttons],
    });

    // Инициализируем пустой набор в памяти по ID сообщения
    activeNabors.set(msg.id, {
      time: time,
      mainList: [],
      reserveList: [],
      leftList: [], // Добавили список покинувших
    });

    // Отправляем 3 сообщения подряд после создания набора
    const followUpText = `${roleMention} рега выше`;
    for (let i = 0; i < 3; i++) {
      await channel.send({ content: followUpText }).catch(console.error);
    }
  },

  // Функция обработки нажатий на кнопки участников
  async handleNaborInteraction(interaction) {
    const { customId, user, message } = interaction;

    // Проверяем, существует ли этот набор в памяти
    if (!activeNabors.has(message.id)) {
      return interaction.reply({
        content:
          "❌ Этот набор устарел или бот был перезапущен. Создайте новый.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const nabor = activeNabors.get(message.id);
    const userId = user.id;

    // Гарантируем наличие массива leftList (для старых наборов, если они останутся в памяти)
    if (!nabor.leftList) nabor.leftList = [];

    // ОБРАБОТКА КНОПКИ "ПРИСОЕДИНИТЬСЯ"
    if (customId === "nabor_join") {
      // Проверяем, нет ли уже пользователя в списках участников
      if (
        nabor.mainList.includes(userId) ||
        nabor.reserveList.includes(userId)
      ) {
        return interaction.reply({
          content: "❌ Вы уже записаны в этот набор!",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Если пользователь раньше выходил, удаляем его из списка "Покинувшие"
      const inLeft = nabor.leftList.indexOf(userId);
      if (inLeft !== -1) {
        nabor.leftList.splice(inLeft, 1);
      }

      // Если в основном списке есть места — добавляем туда
      if (nabor.mainList.length < MAX_MAIN_SEATS) {
        nabor.mainList.push(userId);
        await interaction.reply({
          content: "✅ Вы успешно записались в **основной состав**!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        // Иначе отправляем в резерв
        nabor.reserveList.push(userId);
        await interaction.reply({
          content: "⚠️ Свободных мест нет. Вы добавлены в **резерв**.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // ОБРАБОТКА КНОПКИ "ВЫЙТИ"
    if (customId === "nabor_leave") {
      const inMain = nabor.mainList.indexOf(userId);
      const inReserve = nabor.reserveList.indexOf(userId);

      if (inMain === -1 && inReserve === -1) {
        return interaction.reply({
          content: "❌ Вас нет в списках активных участников этого набора.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (inMain !== -1) {
        // Удаляем из основного состава
        nabor.mainList.splice(inMain, 1);

        // Если в резерве кто-то был, первый из резерва переходит в основной состав
        if (nabor.reserveList.length > 0) {
          const firstFromReserve = nabor.reserveList.shift();
          nabor.mainList.push(firstFromReserve);
        }
      } else if (inReserve !== -1) {
        // Просто удаляем из резерва
        nabor.reserveList.splice(inReserve, 1);
      }

      // Добавляем пользователя в список покинувших (если его там еще нет)
      if (!nabor.leftList.includes(userId)) {
        nabor.leftList.push(userId);
      }

      await interaction.reply({
        content:
          "ℹ️ Вы успешно выписались из набора и перенесены в список покинувших.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Обновляем данные в Map и редактируем сообщение в Дискорде
    activeNabors.set(message.id, nabor);

    const updatedEmbed = createNaborEmbed(
      nabor.time,
      nabor.mainList,
      nabor.reserveList,
      nabor.leftList,
    );
    await message.edit({ embeds: [updatedEmbed] }).catch(console.error);
  },
};
