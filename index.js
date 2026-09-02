const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize, // ИСПРАВЛЕНО: Правильное название енама в discord.js v14
  SectionBuilder,       
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember, Partials.User],
});

client.commands = new Collection();

// Код загрузки команд
const foldersPath = path.join(__dirname, "src/commands");
if (fs.existsSync(foldersPath)) {
  const commandFiles = fs
    .readdirSync(foldersPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(foldersPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else if ("name" in command && "execute" in command) {
      client.commands.set(command.name, command);
    }
  }
}

// Загрузка ивентов
const eventsPath = path.join(__dirname, "src/events");
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    require(filePath)(client);
    console.log(`[Events] Эвент ${file} загружен.`);
  }
}

// --- НАСТРОЙКА WEB СЕРВЕРА ДЛЯ КОНСТРУКТОРА ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API Эндпоинт отправки
app.post("/api/send-container", async (req, res) => {
  try {
    const { channelId, noColor, accentColor, items } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "Не указан ID канала Discord" });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return res.status(404).json({ error: "Канал не найден или у бота нет прав" });
    }

    const container = new ContainerBuilder();

    // Если "без цвета" не активно — ставим цвет полоски
    if (!noColor) {
      container.setAccentColor(accentColor ? parseInt(accentColor.replace("#", "0x")) : 0x5865f2);
    }

    // Парсим элементы
    for (const item of items) {
      if (item.type === "text") {
        if (item.value) {
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(item.value));
        }
      } 
      else if (item.type === "separator") {
        const sep = new SeparatorBuilder();

        if (item.large) {
          // ИСПРАВЛЕНО: Ставим большой отступ и убираем саму серую линию (будет чистое пространство)
          sep.setSpacing(SeparatorSpacingSize.Large);
          sep.setDivider(false);
        } else {
          // Обычный тонкий разделитель с линией
          sep.setSpacing(SeparatorSpacingSize.Small);
          sep.setDivider(true);
        }
        container.addSeparatorComponents(sep);
      } 
      else if (item.type === "section") {
        const section = new SectionBuilder();

        if (item.value) {
          section.setTextDisplayComponent(new TextDisplayBuilder().setContent(item.value));
        }

        // Кнопка принудительно встает в правый край на одной линии с текстом
        if (item.btnLabel && item.btnLink) {
          const button = new ButtonBuilder()
            .setLabel(item.btnLabel)
            .setURL(item.btnLink)
            .setStyle(ButtonStyle.Link);

          section.setTrailingAction(button);
        }

        container.addSectionComponents(section);
      }
    }

    // Отправка
    await channel.send({
      flags: [MessageFlags.IsComponentsV2],
      components: [container]
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка при отправке контейнера с сайта:", err);
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(3000, () => console.log("Server is running on port 3000"));

// Отключение
const shutdown = () => {
  client.destroy();
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Запуск Discord
setTimeout(() => {
  client
    .login(process.env.TOKEN)
    .then(() => console.log("Discord login successful!"))
    .catch((err) => console.error("Discord login error:", err));
}, 5000);

client.on('error', error => {
  console.error('Произошла ошибка клиента Discord:', error);
});

process.on('unhandledRejection', error => {
  console.error('Необработанное исключение (Promise Rejection):', error);
});
