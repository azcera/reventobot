const {
  Events,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ButtonBuilder,
} = require("discord.js");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const path = require("path");

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const majesticBotUsername = "MajesticRolePlayBot";
const discordChannelId = process.env.CAPT_INFO_CHANNEL_ID;
const stringSession = new StringSession(process.env.TG_SESSION || "");

module.exports = (client) => {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Готово! Вход как ${readyClient.user.tag}`);

    console.log("Запуск Telegram клиента...");
    const tgClient = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    await tgClient.start({
      phoneNumber: async () =>
        promptConsole("Введите номер телефона (с кодом страны): "),
      password: async () => promptConsole("Введите 2FA пароль (если есть): "),
      phoneCode: async () => promptConsole("Введите код подтверждения из ТГ: "),
    });

    console.log("Успешно подключено к Telegram!");

    if (!process.env.TG_SESSION) {
      console.log(
        "\n================ СКОПИРУЙТЕ СТРОКУ НИЖЕ И ВСТАВЬТЕ В .env КАК TG_SESSION ================",
      );
      console.log(tgClient.session.save());
      console.log(
        "========================================================================================\n",
      );
    }

    tgClient.addEventHandler(async (event) => {
      try {
        const message = event.message;

        const sender = await message.getSender();
        if (
          !sender ||
          (sender.username !== majesticBotUsername &&
            sender.id?.toString() !== majesticBotUsername)
        )
          return;

        const text = message.text || "";

        const isAttackMessage = /Ваша организация\s+.+?\s+напала на/i.test(
          text,
        );
        const isDefendMessage = /На вашу организацию\s+.+?\s+напали/i.test(
          text,
        );

        if (!isAttackMessage && !isDefendMessage) return;

        console.log(
          `[Telegram] Обнаружено уведомление о бизваре/капте! Парсим данные...`,
        );

        let isAttack = isAttackMessage;
        let attacker = "Неизвестно";
        let defender = "Неизвестно";

        if (isAttack) {
          const match = text.match(
            /Ваша организация\s+([^\n]+?)\s+напала на\s+([^\n!]+)/i,
          );
          if (match) {
            attacker = match[1].trim();
            defender = match[2].trim();
          }
        } else {
          const match = text.match(
            /На вашу организацию\s+([^\n]+?)\s+напали\s+([^\n!]+)/i,
          );
          if (match) {
            attacker = match[2].trim();
            defender = match[1].trim();
          }
        }

        const startTime = (
          text.match(/Начало:\s*([^\n]+)/i)?.[1] || "Не указано"
        ).trim();
        const zoneName = (
          text.match(/Название квадрата:\s*([^\n]+)/i)?.[1] || "Не указано"
        ).trim();
        const zoneNum = (
          text.match(/Номер квадрата:\s*([^\n]+)/i)?.[1] || "Не указано"
        ).trim();
        const count = (
          text.match(/Количество нападающих:\s*([^\n]+)/i)?.[1] || "Не указано"
        ).trim();

        const channel = await client.channels.fetch(discordChannelId);
        if (!channel)
          return console.error("[Discord] Канал для каптов не найден!");

        const imagePath = path.join(__dirname, "..", "images", "capt.png");

        const localImage = new AttachmentBuilder(imagePath, {
          name: "capt.png",
        });

        const captImage = new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL("attachment://capt.png")
            .setDescription("CAPT"),
        );

        const enemyFaction = (isAttack ? defender : attacker).replace(
          /\s+/g,
          "-",
        );
        const cleanTime = startTime.replace(/\s+/g, "-");

        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`capt_${enemyFaction}_${cleanTime}`)
            .setLabel(
              isAttack
                ? "⚔️ Создать регу на АТАКУ ⚔️"
                : "🛡️ Создать регу на ЗАЩИТУ 🛡️",
            )

            .setStyle(isAttack ? ButtonStyle.Success : ButtonStyle.Primary),
        );

        const container = new ContainerBuilder()
          .setAccentColor(isAttack ? 0x57f287 : 0x5865f2)
          .addMediaGalleryComponents(captImage)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              isAttack ? "# ⚔️ КАПТ АТАКА ⚔️ " : "# 🛡️ КАПТ ЗАЩИТА 🛡️",
            ),
          )
          .addSeparatorComponents(new SeparatorBuilder())
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `> ### 🆚 Против: \`${isAttack ? defender : attacker}\`\n` +
                `> ### ⏰ Начало: \`${startTime}\`\n` +
                `> ### 🗺️ Квадрат: \`${zoneName} (${zoneNum})\`\n` +
                `> ### 👥 Кол-во врагов: \`${count}\``,
            ),
          )
          .addActionRowComponents(actionRow);

        await channel.send({
          flags: [MessageFlags.IsComponentsV2],
          components: [container],
          files: [localImage],
        });

        console.log(`[Discord] Сообщение успешно отправлено в канал!`);
      } catch (err) {
        console.error("[Telegram Event Error]:", err);
      }
    }, new NewMessage({}));
  });
};

function promptConsole(query) {
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    readline.question(query, (auth) => {
      readline.close();
      resolve(auth);
    }),
  );
}
