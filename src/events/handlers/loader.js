const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

module.exports = (client) => {
  // 1. Загрузка команд из src/commands/
  const commandsPath = path.join(__dirname, "../../commands");

  // Рекурсивный поиск во всех подпапках (например, utility)
  const getFilesRecursively = (dir) => {
    let files = [];
    if (!fs.existsSync(dir)) return files;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        files = [...files, ...getFilesRecursively(path.join(dir, item.name))];
      } else if (item.name.endsWith(".js")) {
        files.push(path.join(dir, item.name));
      }
    }
    return files;
  };

  const commandFiles = getFilesRecursively(commandsPath);
  const commandsData = [];

  for (const filePath of commandFiles) {
    const command = require(filePath);
    const fileName = path.basename(filePath);

    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      commandsData.push(command.data.toJSON());
    } else if (command.name && command.execute) {
      client.commands.set(command.name, command);
    } else {
      console.log(`[WARNING] Команда ${fileName} пропущена: нет data/name или execute`);
    }
  }

  // 2. Регистрация слэш-команд в Discord API
  if (commandsData.length > 0) {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    (async () => {
      try {
        console.log(`[REST] Обновление ${commandsData.length} слэш-команд...`);
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
          { body: commandsData }
        );
        console.log("[REST] Слэш-команды успешно обновлены.");
      } catch (error) {
        console.error("[REST Error]", error);
      }
    })();
  }

  // 3. Загрузка событий из src/events/ (не включая папку handlers)
  const eventsPath = path.join(__dirname, "../");
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(".js"));

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    console.log(`[Events] Событие ${event.name} успешно привязано.`);
  }
};
