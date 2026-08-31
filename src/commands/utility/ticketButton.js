module.exports = async (client) => {
  const {
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    roleMention,
  } = require("discord.js");

  require("dotenv").config();

  const channel = await client.channels.fetch(process.env.WARN_CHANNEL_ID);

  // Создаём кнопку
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Создать тикет")
      .setStyle(ButtonStyle.Primary),
  );

  // Ищем сообщение с кнопкой
  const messages = await channel.messages.fetch({ limit: 10 });
  const existingMessage = messages.find(
    (msg) => msg.components?.[0]?.components?.[0]?.customId === "create_ticket",
  );
  const content = `**ЗА ЧТО ВЫДАЮТ ВАРНЫ?**

\`\`\`css
1. Неуместная неадекватность
2. Спам в войсе
3. Отсутствие активности в семье без отписанной причины в AFK (нвс)
4. Действия, приводящие к плохим последствиям для семьи
5. Отсутствие дисциплины (неуважение)
\`\`\`

**СИСТЕМА СНЯТИЯ ВАРНОВ**

Для снятие варна нужно посетить 4 семейных мероприятия и создав кнопкой ниже заявку, отправить доказательства присутствия в канал.

За семейные мероприятия считается:

**\`КОНТРАКТЫ\`**: Ценная партия, Подставная стройка, Конспирация

**\`ТАЙНИКИ\`**: 02:00, 06:00, 10:00, 14:00, 18:00, 22:00
**\`ДРОП\`**: 04:00, 08:00, 12:00, 16:00, 20:00, 00:00
**\`ДИЛЛЕРЫ\`**: 10:45, 18:45
**\`ЦЕХА\`**: 14:45, 22:45
**\`ОГРАБЛЕНИЯ\`**: 12:00-01:00

**\`КАПТЫ (15:00-21:00) / ОСТРОВ (17:00-20:00, 21:00-23:00)\`**: ПОНЕДЕЛЬНИК, СРЕДА, ПЯТНИЦА, ВОСКРЕСЕНЬЕ

||${roleMention(process.env.MENTIONED_ROLE)}||`;
  if (existingMessage) {
    // Обновляем существующее сообщение
    await existingMessage.edit({
      content,
      allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
      components: [row],
    });
    console.log("Сообщение с кнопкой обновлено");
  } else {
    await channel.send({
      content,
      allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
      components: [row],
    });
    console.log("Сообщение с кнопкой отправлено");
  }
  return;
};
