const { createChannel } = require('../commands/utility/createChannel');
const { MessageFlags } = require('discord.js')
require('dotenv').config();

module.exports = (client) => {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        const [action, name, stat, memberID] = interaction.customId.split(':');

        const guild = interaction.guild;
        if (!guild) return;

        const member = await guild.members.fetch(memberID).catch(() => null);
        if (!member) return interaction.reply({ content: 'Пользователь не найден.', flags: MessageFlags.Ephemeral });

        if (action === 'cancel_create') {
            console.log('Создание архива отменено.')
            await interaction.message.delete().catch(err => console.log('Не удалось удалить сообщение:', err));
        }

        if (action === 'create_archive') {
            await interaction.message.delete().catch(err => console.log('Не удалось удалить сообщение:', err));
            await createChannel(interaction, {channelName: `archive-${name}-${stat}`, memberID: member.id, guild, categoryID: process.env.CATEGORY_ID });
        }


    })
}