const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
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

// Код загрузки команд (оставляем ваш рабочий вариант)
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

// ПРАВИЛЬНАЯ ЗАГРУЗКА ИЗ ПАПКИ src/events/ (БЕЗ HANDLERS)
const eventsPath = path.join(__dirname, "src/events");
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    // Просто подключаем файл события и передаем туда client
    require(filePath)(client);
    console.log(`[Events] Эвент ${file} загружен.`);
  }
}

// Сервер
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
const server = app.listen(3000, () => console.log("Server is running"));

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