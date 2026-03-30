require("dotenv").config();

module.exports = (client) => {
  const PREFIX = "!"; // префикс для обычных команд

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return; // игнорируем ботов
    if (!message.content.startsWith(PREFIX)) return; // проверяем префикс

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
      await command.execute(message, args);
    } catch (error) {
      console.error(error);
      await message.channel.send("Произошла ошибка при выполнении команды!");
    }
  });
};
