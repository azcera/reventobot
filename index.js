const {
  REST,
  Routes,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");

const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

// Настройки Telegram из .env
const apiId = Number(process.env.TG_API_ID); // Обязательно число
const apiHash = process.env.TG_API_HASH;
const majesticBotUsername = "MajesticRolePlayBot";
const discordChannelId = "1445808133569249297";

// Сессия берется из .env. Если её там нет — будет пустая строка для первой авторизации
const stringSession = new StringSession(process.env.TG_SESSION || "");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember, Partials.User],
});

// эвенты
const eventsPath = path.join(__dirname, "src/events");
const eventsFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of eventsFiles) {
  const filePath = path.join(eventsPath, file);
  require(filePath)(client);
  console.log(`Эвент ${file} загружен.`);
}

// коллекция команд
client.commands = new Collection();

const foldersPath = path.join(__dirname, "src/commands");
const commandFiles = fs
  .readdirSync(foldersPath)
  .filter((file) => file.endsWith(".js"));

// загружаем команды
for (const file of commandFiles) {
  const filePath = path.join(foldersPath, file);
  const command = require(filePath);
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else if ("name" in command && "execute" in command) {
    client.commands.set(command.name, command);
  } else {
    console.log(
      `[WARNING] Команда ${file} пропущена: нет data/name или execute`,
    );
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Готово! Вход как ${readyClient.user.tag}`);
});

// Функция инициализации Telegram-клиента
async function initTelegram() {
  console.log("Запуск Telegram клиента...");
  const tgClient = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  // Интерактивный ввод данных в консоли при первом запуске
  await tgClient.start({
    phoneNumber: async () => {
      const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise((resolve) =>
        readline.question(
          "Введите номер телефона (с кодом страны): ",
          (auth) => {
            readline.close();
            resolve(auth);
          },
        ),
      );
    },
    password: async () => {
      const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise((resolve) =>
        readline.question("Введите 2FA пароль (если есть): ", (auth) => {
          readline.close();
          resolve(auth);
        }),
      );
    },
    phoneCode: async () => {
      const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise((resolve) =>
        readline.question("Введите код подтверждения из ТГ: ", (auth) => {
          readline.close();
          resolve(auth);
        }),
      );
    },
  });

  console.log("Успешно подключено к Telegram!");

  // Если вы зашли первый раз — этот лог покажет токен сессии. Сохраните его в .env (TG_SESSION)
  if (!process.env.TG_SESSION) {
    console.log(
      "\n================ СКОПИРУЙТЕ СТРОКУ НИЖЕ И ВСТАВЬТЕ В .env КАК TG_SESSION ================",
    );
    console.log(tgClient.session.save());
    console.log(
      "========================================================================================\n",
    );
  }

  // Обработчик новых сообщений
  tgClient.addEventHandler(async (event) => {
    try {
      const message = event.message;
      const sender = await message.getSender();

      // Игнорируем всех, кроме официального бота Majestic
      if (!sender || sender.username !== majesticBotUsername) return;

      const text = message.text || "";

      // ФИЛЬТРАЦИЯ: Реагируем только если в тексте есть упоминание капта/каптов (регистр не важен)
      if (!/капт/i.test(text)) return;

      console.log(
        `[Telegram] Обнаружено сообщение о капте! Пересылаю в Discord...`,
      );

      // 1. Определяем тип капта (Атака или Защита)
      let isAttack = /напала на/i.test(text);
      let attacker = "Неизвестно";
      let defender = "Неизвестно";

      if (isAttack) {
        // Ваша организация REVENTO напала на Old money!
        const match = text.match(
          /Ваша организация\s+([^\n]+?)\s+напала на\s+([^\n!]+)/i,
        );
        if (match) {
          attacker = match[1].trim();
          defender = match[2].trim();
        }
      } else {
        // На вашу организацию REVENTO напали Culture!
        const match = text.match(
          /На вашу организацию\s+([^\n]+?)\s+напали\s+([^\n!]+)/i,
        );
        if (match) {
          attacker = match[2].trim(); // Тот кто напал — атакующий
          defender = match[1].trim(); // Ваша организация — защищается
        }
      }

      // 2. Вытаскиваем остальные данные по строкам
      const serverMatch = text.match(/Сервер:\s*([^\n]+)/i);
      const startMatch = text.match(/Начало:\s*([^\n]+)/i);
      const zoneMatch = text.match(/Название квадрата:\s*([^\n]+)/i);
      const zoneNumMatch = text.match(/Номер квадрата:\s*([^\n]+)/i);
      const countMatch = text.match(/Количество нападающих:\s*([^\n]+)/i);

      const serverName = serverMatch ? serverMatch[1].trim() : "Miami";
      const startTime = startMatch ? startMatch[1].trim() : "Не указано";
      const zoneName = zoneMatch ? zoneMatch[1].trim() : "Не указано";
      const zoneNum = zoneNumMatch ? zoneNumMatch[1].trim() : "Не указано";
      const count = countMatch ? countMatch[1].trim() : "Не указано";
      // Получаем канал в Discord
      const channel = await client.channels.fetch(discordChannelId);
      if (!channel)
        return console.error("[Discord] Канал для каптов не найден!");

      // Создаем Embed сообщение
      const embed = new EmbedBuilder()
        .setTitle(
          isAttack
            ? "⚔️ МЫ НАПАДАЕМ (АТАКА) ⚔️"
            : "🛡️ НА НАШУ ТЕРРУ НАПАЛИ (ЗАЩИТА) 🛡️",
        )
        .setDescription(`**Сервер:** ${serverName}`)
        .setColor(isAttack ? 0x2ecc71 : 0xe74c3c) // Зеленый для атаки, Красный для защиты
        .addFields(
          { name: "⚔️ Атакующие", value: attacker, inline: true },
          { name: "🛡️ Защита", value: defender, inline: true },
          { name: "⏰ Начало", value: startTime, inline: true },
          {
            name: "🗺️ Квадрат",
            value: `${zoneName} (${zoneNum})`,
            inline: true,
          },
          { name: "👥 Кол-во врагов", value: count, inline: true },
          {
            name: "✅ Пойдут (0):",
            value: "Пока никто не плюсанул",
            inline: false,
          },
        )
        .setTimestamp();

      // Отправляем сообщение с пингом
      await channel.send({
        content:
          "🚨 **@everyone Обнаружена активность по каптам! Собираем состав!** 🚨",
        embeds: [embed],
      });
    } catch (err) {
      console.error("[Telegram Event Error]:", err);
    }
  }, new NewMessage({}));
}

// Запуск бота Discord с вашей задержкой в 5 секунд
setTimeout(() => {
  client
    .login(process.env.TOKEN)
    .then(() => {
      console.log("Discord login successful!");
      // Telegram запускается ТОЛЬКО после того, как Discord успешно вошел в сеть
      initTelegram().catch(console.error);
    })
    .catch((err) => console.error("Discord login error:", err));
}, 5000);

// обработка взаимодействий
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "Произошла ошибка при запуске команды!",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: "Произошла ошибка при запуске команды!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

// регистрация команд в Discord
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    const commandsData = Array.from(client.commands.values())
      .filter((cmd) => cmd.data)
      .map((cmd) => cmd.data.toJSON());
    console.log(
      `Начало обновления ${commandsData.length} команд (/) приложения.`,
    );
    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      { body: commandsData },
    );
    console.log(`Успешно обновлено ${data.length} команд (/) приложения.`);
  } catch (error) {
    console.error(error);
  }
})();

// сервер
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

const server = app.listen(3000, () => {
  console.log("Server is running");
});

process.on("SIGTERM", () => {
  console.log("SIGTERM получен — отключаемся от Discord...");
  client.destroy();
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT получен — отключаемся от Discord...");
  client.destroy();
  server.close(() => process.exit(0));
});
