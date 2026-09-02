const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { buildWebContainer } = require("./src/services/containerService"); // Импорт нашего сервиса
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

// --- НАСТРОЙКА WEB СЕРВЕРА ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Лаконичный эндпоинт API
app.post("/api/send-container", async (req, res) => {
  try {
    const { channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({ error: "Не указан ID канала Discord" });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return res
        .status(404)
        .json({ error: "Канал не найден или у бота нет к нему прав" });
    }

    // Собираем payload через вынесенный сервис
    const messagePayload = buildWebContainer(req.body);

    // Публикуем в текстовый канал
    await channel.send(messagePayload);

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка при отправке контейнера с сайта:", err);
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(3000, () =>
  console.log("Server is running on port 3000"),
);

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

client.on("error", (error) => {
  console.error("Произошла ошибка клиента Discord:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Необработанное исключение (Promise Rejection):", error);
});
