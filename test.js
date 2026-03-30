const { REST, Routes } = require("discord.js");

require("dotenv").config();

// регистрация команд в Discord
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      { body: [] },
    );
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: [],
    });
  } catch (error) {
    console.error(error);
  }
})();
