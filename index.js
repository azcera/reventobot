const { REST, Routes, Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { clientId, guildId } = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const token = process.env.TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages], partials: ["GUILD_MEMBER"] });


// эвенты

const eventsPath = path.join(__dirname, 'events');
const eventsFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventsFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
    require(filePath)(client);
    console.log(`Эвент ${file} загружен.`)

}



// коллекция команд
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(foldersPath).filter(file => file.endsWith('.js'));

// загружаем команды
for (const file of commandFiles) {
	const filePath = path.join(foldersPath, file);
	const command = require(filePath);
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command); // сохраняем полностью
	} else {
		console.log(`[WARNING] Команда ${file} пропущена: нет data или execute`);
	}
}

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Готово! Вход как ${readyClient.user.tag}`);
});

client.login(token);

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
			await interaction.followUp({ content: 'Произошла ошибка при запуске команды!', flags: MessageFlags.Ephemeral });
		} else {
			await interaction.reply({ content: 'Произошла ошибка при запуске команды!', flags: MessageFlags.Ephemeral });
		}
	}
});

// регистрация команд в Discord
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
	try {
		const commandsData = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON()); // только JSON для Discord
		console.log(`Начало обновления ${commandsData.length} команд (/) приложения.`);
        // const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandsData });
		const data = await rest.put(Routes.applicationCommands(clientId), { body: commandsData });
		console.log(`Успешно обновлено ${data.length} команд (/) приложения.`);
	} catch (error) {
		console.error(error);
	}
})();