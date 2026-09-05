const { Events } = require("discord.js");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const path = require("path");
const readline = require("readline"); // Добавляем readline для четкого ввода

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const majesticBotUsername = "MajesticRolePlayBot";
const discordChannelId = process.env.CAPT_INFO_CHANNEL_ID;

// Если сессии нет, создаем пустую. Если есть - используем её.
const stringSession = new StringSession(process.env.TG_SESSION || "");

const processedCapts = new Map();

// Настраиваем readline специально для стабильной работы в Replit
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const promptConsole = (query) => {
  return new Promise((resolve) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`❓ ${query}`);
    console.log(
      `👉 (СРОЧНО: Кликните мышкой в это черное окно консоли, введите ответ и нажмите Enter)`,
    );
    console.log(`${"=".repeat(60)}\n`);
    rl.question("", (answer) => {
      resolve(answer.trim());
    });
  });
};

module.exports = (client) => {
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`✅ Готово! Вход как ${readyClient.user.tag}`);

    console.log("🔄 Запуск Telegram клиента...");
    const tgClient = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: false, // Отключаем WebSocket для большей стабильности TCP в Replit
    });

    try {
      await tgClient.start({
        phoneNumber: async () =>
          await promptConsole(
            "Введите номер телефона (с кодом страны, без +, например 79959868231):",
          ),
        password: async () =>
          await promptConsole(
            "Введите 2FA пароль (если он у вас включен, иначе просто нажмите Enter):",
          ),
        phoneCode: async () =>
          await promptConsole("Введите 5-значный код из приложения Telegram:"),
        onError: (err) => console.error("❌ Ошибка Telegram:", err),
      });

      console.log("✅ Успешно подключено к Telegram!");

      // Если сессии не было в .env, выводим новую
      if (!process.env.TG_SESSION) {
        const newSession = tgClient.session.save();
        console.log("\n🔥 🔥 🔥 ВАЖНО: СКОПИРУЙТЕ СТРОКУ НИЖЕ 🔥 🔥 🔥");
        console.log(newSession);
        console.log(
          "🔥 🔥 🔥 И ВСТАВЬТЕ ЕЁ В SECRETS (или .env) КАК TG_SESSION 🔥 🔥 🔥\n",
        );
        console.log(
          "После этого перезапустите бота, и код больше спрашиваться не будет!",
        );
      }

      console.log("👂 Слушаю уведомления от MajesticRolePlayBot...");

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

          if (/нейтрал/i.test(attacker) || /нейтрал/i.test(defender)) return;

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
            text.match(/Количество нападающих:\s*([^\n]+)/i)?.[1] ||
            "Не указано"
          ).trim();

          const captKey = `${attacker}_${defender}_${startTime}_${zoneNum}`
            .toLowerCase()
            .replace(/\s+/g, "");

          if (processedCapts.has(captKey)) return;

          processedCapts.set(captKey, true);
          setTimeout(() => {
            processedCapts.delete(captKey);
          }, 300000);

          console.log(
            `[Telegram] Обнаружен капт: ${attacker} vs ${defender} (Квадрат ${zoneNum})`,
          );

          const channel = await client.channels.fetch(discordChannelId);
          if (!channel)
            return console.error("[Discord] Канал для каптов не найден!");

          const imagePath = path.join(__dirname, "..", "images", "capt.png");
          const localImage = new (require("discord.js").AttachmentBuilder)(
            imagePath,
            { name: "capt.png" },
          );
          const captImage =
            new (require("discord.js").MediaGalleryBuilder)().addItems(
              new (require("discord.js").MediaGalleryItemBuilder)()
                .setURL("attachment://capt.png")
                .setDescription("CAPT"),
            );

          const enemyFaction = (isAttack ? defender : attacker).replace(
            /\s+/g,
            "-",
          );
          const cleanTime = startTime.replace(/\s+/g, "-");

          const actionRow =
            new (require("discord.js").ActionRowBuilder)().addComponents(
              new (require("discord.js").ButtonBuilder)()
                .setCustomId(`capt_${enemyFaction}_${cleanTime}`)
                .setLabel(
                  isAttack
                    ? "⚔️ Создать регу на АТАКУ ⚔️"
                    : "🛡️ Создать регу на ЗАЩИТУ 🛡️",
                )
                .setStyle(
                  isAttack
                    ? require("discord.js").ButtonStyle.Success
                    : require("discord.js").ButtonStyle.Primary,
                ),
            );

          const container = new (require("discord.js").ContainerBuilder)()
            .setAccentColor(isAttack ? 0x57f287 : 0x5865f2)
            .addMediaGalleryComponents(captImage)
            .addTextDisplayComponents(
              new (require("discord.js").TextDisplayBuilder)().setContent(
                isAttack ? "# ⚔️ КАПТ АТАКА ⚔️ " : "# 🛡️ КАПТ ЗАЩИТА 🛡️",
              ),
            )
            .addSeparatorComponents(
              new (require("discord.js").SeparatorBuilder)(),
            )
            .addTextDisplayComponents(
              new (require("discord.js").TextDisplayBuilder)().setContent(
                `> ### 🆚 Против: \`${isAttack ? defender : attacker}\`\n` +
                  `> ### ⏰ Начало: \`${startTime}\`\n` +
                  `> ### 🗺️ Квадрат: \`${zoneName} (${zoneNum})\`\n` +
                  `> ### 👥 Кол-во врагов: \`${count}\`\n` +
                  `> ### ||@everyone||`,
              ),
            )
            .addActionRowComponents(actionRow);

          await channel.send({
            flags: [require("discord.js").MessageFlags.IsComponentsV2],
            components: [container],
            files: [localImage],
          });
        } catch (err) {
          console.error("[Telegram Event Error]:", err);
        }
      }, new NewMessage({}));
    } catch (error) {
      console.error("❌ Критическая ошибка при запуске Telegram:", error);
    }
  });
};
