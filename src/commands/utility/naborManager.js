const {
  SectionBuilder,
  MessageFlags,
  ActionRowBuilder,
  TextDisplayBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
} = require("discord.js");
require("dotenv").config();

const PLUS_CHANNEL = process.env.PLUS_CHANNEL_ID;
const MAX_MAIN = 20;

const activeCaptures = new Map();

// Вспомогательная функция для сборки компонентов сообщения на основе списков
function buildCaptureMessage(
  discordTimestamp,
  mainList,
  reserveList,
  leftList,
) {
  const title = new TextDisplayBuilder().setContent("## 📢 Рега на капт!");
  const time = new TextDisplayBuilder().setContent(
    "## Время проведения: " + discordTimestamp,
  );
  const helpText = new TextDisplayBuilder().setContent(
    "-# Нажмите на кнопку ниже, чтобы записаться на капт.",
  );

  // Формируем текст списков с упоминаниями пользователей
  const mainPlayersText =
    mainList.length > 0
      ? mainList.map((id, index) => `${index + 1}. <@${id}>`).join("\n")
      : "Пусто";
  const reservePlayersText =
    reserveList.length > 0
      ? reserveList.map((id, index) => `${index + 1}. <@${id}>`).join("\n")
      : "Пусто";
  const leftPlayersText =
    leftList.length > 0
      ? leftList.map((id, index) => `• <@${id}>`).join("\n")
      : "Пусто";

  const mainTitle = new TextDisplayBuilder().setContent(
    `### 👥 Основной состав (${mainList.length}/${MAX_MAIN})\n${mainPlayersText}`,
  );
  const reserveTitle = new TextDisplayBuilder().setContent(
    `### 🤝 Резерв (${reserveList.length})\n${reservePlayersText}`,
  );
  const leftTitle = new TextDisplayBuilder().setContent(
    `### 🚪 Покинули набор (${leftList.length})\n${leftPlayersText}`,
  );

  const containerComponent = new ContainerBuilder()
    .addTextDisplayComponents(title, time, helpText)
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(mainTitle);

  if (reserveList.length > 0) {
    containerComponent
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(reserveTitle);
  }

  if (leftList.length > 0) {
    containerComponent
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(leftTitle);
  }

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("capt_join")
      .setLabel("✅ Принять")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("capt_leave")
      .setLabel("❌ Выйти")
      .setStyle(ButtonStyle.Danger),
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [containerComponent, buttonsRow],
  };
}

module.exports = {
  // 1. Создание и отправка первоначального набора
  async sendNabor(interaction, discordTimestamp) {
    const guild = interaction.guild;
    const channel = guild.channels.cache.get(PLUS_CHANNEL);

    const mainList = [];
    const reserveList = [];
    const leftList = [];

    const messageData = buildCaptureMessage(
      discordTimestamp,
      mainList,
      reserveList,
      leftList,
    );
    const message = await channel.send(messageData);
    for (let i = 0; i < 3; i++) {
      await channel.send({
        content: `<@&${process.env.MENTIONED_ROLE}> рега выше`,
      });
    }
    // Сохраняем состояние для этого конкретного сообщения
    activeCaptures.set(message.id, {
      discordTimestamp,
      mainList,
      reserveList,
      leftList,
    });
  },

  // 2. Обработчик нажатий на кнопки (вызывать из главного файла бота в interactionCreate)
  async handleButton(interaction) {
    if (!interaction.isButton()) return;
    if (
      interaction.customId !== "capt_join" &&
      interaction.customId !== "capt_leave"
    )
      return;

    const messageId = interaction.message.id;
    const captureData = activeCaptures.get(messageId);

    // Если бот перезапускался и память очистилась
    if (!captureData) {
      return interaction.reply({
        content: "❌ Данная регистрация устарела или неактивна.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.user.id;
    let { discordTimestamp, mainList, reserveList, leftList } = captureData;

    if (interaction.customId === "capt_join") {
      // Проверяем, нет ли уже игрока в списках
      if (mainList.includes(userId) || reserveList.includes(userId)) {
        return interaction.reply({
          content: "Вы уже записаны на капт!",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Удаляем из списка вышедших, если он там был
      const leftIndex = leftList.indexOf(userId);
      if (leftIndex !== -1) leftList.splice(leftIndex, 1);

      // Добавляем в основу или резерв
      if (mainList.length < MAX_MAIN) {
        mainList.push(userId);
      } else {
        reserveList.push(userId);
      }
    } else if (interaction.customId === "capt_leave") {
      const mainIndex = mainList.indexOf(userId);
      const reserveIndex = reserveList.indexOf(userId);

      // Если игрока вообще нигде нет
      if (mainIndex === -1 && reserveIndex === -1) {
        return interaction.reply({
          content: "Вас и так нет в списках.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Если выходим из основы
      if (mainIndex !== -1) {
        mainList.splice(mainIndex, 1);

        // Передвигаем первого человека из резерва в основу (опционально, но логично)
        if (reserveList.length > 0) {
          const movingPlayer = reserveList.shift();
          mainList.push(movingPlayer);
        }
      }
      // Если выходим из резерва
      else if (reserveIndex !== -1) {
        reserveList.splice(reserveIndex, 1);
      }

      // Добавляем в список вышедших (если еще не там)
      if (!leftList.includes(userId)) {
        leftList.push(userId);
      }
    }

    // Сохраняем обновленные данные обратно в Map
    activeCaptures.set(messageId, {
      discordTimestamp,
      mainList,
      reserveList,
      leftList,
    });

    // Генерируем новые компоненты и обновляем сообщение бота
    const updatedMessageData = buildCaptureMessage(
      discordTimestamp,
      mainList,
      reserveList,
      leftList,
    );
    await interaction.update(updatedMessageData);
  },
};
