const {
  MessageFlags,
  ActionRowBuilder,
  TextDisplayBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SeparatorBuilder,
  ChannelType 
} = require("discord.js");
require("dotenv").config();

const pool = require("./db.js"); 

const PLUS_CHANNEL = process.env.PLUS_CHANNEL_ID;

function buildCaptureMessage(
  discordTimestamp,
  mainList,
  reserveList,
  leftList,
  target,
  maxMain,
) {
  const title = new TextDisplayBuilder().setContent(
    `## 📢 Рега на ${target ?? "капт"}!`,
  );
  const time = new TextDisplayBuilder().setContent(
    "## Время проведения: " + discordTimestamp,
  );

  const helpText = new TextDisplayBuilder().setContent(
    "-# Нажмите на кнопку ниже, чтобы записаться на капт.",
  );

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
    `### 👥 Основной состав (${mainList.length}/${maxMain})\n${mainPlayersText}`,
  );
  const reserveTitle = new TextDisplayBuilder().setContent(
    `### 🤝 Резерв (${reserveList.length})\n${reservePlayersText}`,
  );
  const leftTitle = new TextDisplayBuilder().setContent(
    `### 🚪 Покинули набор (${leftList.length})\n${leftPlayersText}`,
  );

  const containerComponent = new ContainerBuilder();

  containerComponent.addTextDisplayComponents(title, time, helpText);

  containerComponent
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

  // Кнопки управления для участников и админов
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("capt_join")
      .setLabel("✅ Принять")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("capt_leave")
      .setLabel("❌ Выйти")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("capt_edit_time_trigger") // Название кнопки для перехвата админ права
      .setLabel("✏️ Время")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [containerComponent, buttonsRow],
  };
}

module.exports = {
  buildCaptureMessage, // Экспортируем, чтобы использовать в функции редактирования времени

  async sendNabor(interaction, discordTimestamp, target = null, maxMain = 20) {
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
      target,
      maxMain,
    );
    const message = await channel.send(messageData);
    for (let i = 0; i < 3; i++) {
      await channel.send({
        content: `<@&${process.env.AUTO_ROLE}> рега выше`,
      });
    }

    try {
      await pool.query(
        `INSERT INTO active_captures (message_id, discord_timestamp, main_list, reserve_list, left_list, target, max_main)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          message.id,
          discordTimestamp,
          JSON.stringify(mainList),
          JSON.stringify(reserveList),
          JSON.stringify(leftList),
          target,
          maxMain,
        ],
      );
    } catch (err) {
      console.error("Не удалось сохранить набор в БД:", err);
    }
  },

  // Метод для обновления времени из модального окна
  async updateNaborTime(message, newTimestamp) {
    let row;
    try {
      const res = await pool.query(
        "SELECT * FROM active_captures WHERE message_id = $1",
        [message.id],
      );
      row = res.rows[0];
    } catch (err) {
      console.error("Ошибка при получении данных для изменения времени:", err);
      return;
    }

    if (!row) return;

    // Сохраняем новое время в базу данных
    try {
      await pool.query(
        "UPDATE active_captures SET discord_timestamp = $1 WHERE message_id = $2",
        [newTimestamp, message.id],
      );
    } catch (err) {
      console.error("Ошибка при обновлении времени в БД:", err);
      return;
    }

    // Перерисовываем сообщение с новыми данными
    const updatedMessageData = buildCaptureMessage(
      newTimestamp,
      row.main_list || [],
      row.reserve_list || [],
      row.left_list || [],
      row.target,
      row.max_main || 20,
    );

    await message.edit(updatedMessageData).catch(console.error);
  },

  async handleButton(interaction) {
    if (!interaction.isButton()) return;
    if (
      interaction.customId !== "capt_join" &&
      interaction.customId !== "capt_leave"
    )
      return;

    const messageId = interaction.message.id;

    let row;
    try {
      const res = await pool.query(
        "SELECT * FROM active_captures WHERE message_id = $1",
        [messageId],
      );
      row = res.rows[0];
    } catch (err) {
      console.error("Ошибка при поиске набора в БД:", err);
    }

    if (!row) {
      return interaction.reply({
        content: "❌ Данная регистрация устарела или неактивна.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const discordTimestamp = row.discord_timestamp;
    const target = row.target;
    const maxMain = row.max_main || 20;

    let mainList = row.main_list || [];
    let reserveList = row.reserve_list || [];
    let leftList = row.left_list || [];

    const userId = interaction.user.id;

    if (interaction.customId === "capt_join") {
      if (mainList.includes(userId) || reserveList.includes(userId)) {
        return interaction.reply({
          content: "Вы уже записаны на капт!",
          flags: [MessageFlags.Ephemeral],
        });
      }

      const leftIndex = leftList.indexOf(userId);
      if (leftIndex !== -1) leftList.splice(leftIndex, 1);

      if (mainList.length < maxMain) {
        mainList.push(userId);
      } else {
        reserveList.push(userId);
      }
    } else if (interaction.customId === "capt_leave") {
      const mainIndex = mainList.indexOf(userId);
      const reserveIndex = reserveList.indexOf(userId);

      if (mainIndex === -1 && reserveIndex === -1) {
        return interaction.reply({
          content: "Вас и так нет в списках.",
          flags: [MessageFlags.Ephemeral],
        });
      }

      if (mainIndex !== -1) {
        mainList.splice(mainIndex, 1);

        if (reserveList.length > 0) {
          const movingPlayer = reserveList.shift();
          mainList.push(movingPlayer);
        }
      } else if (reserveIndex !== -1) {
        reserveList.splice(reserveIndex, 1);
      }

      if (!leftList.includes(userId)) {
        leftList.push(userId);
      }
    }

    try {
      await pool.query(
        `UPDATE active_captures 
         SET main_list = $1, reserve_list = $2, left_list = $3
         WHERE message_id = $4`,
        [
          JSON.stringify(mainList),
          JSON.stringify(reserveList),
          JSON.stringify(leftList),
          messageId,
        ],
      );
    } catch (err) {
      console.error("Не удалось обновить данные набора в БД:", err);
      return interaction.reply({
        content: "❌ Произошла ошибка базы данных при сохранении.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const updatedMessageData = buildCaptureMessage(
      discordTimestamp,
      mainList,
      reserveList,
      leftList,
      target,
      maxMain,
    );
    await interaction.update(updatedMessageData);
  },
};
