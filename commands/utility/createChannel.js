const { MessageFlags } = require('discord.js')

async function createChannel (interaction, {channelName, memberID, guild, categoryID})  {
    const newChannel = await guild.channels.create({
        name: channelName,
        type: 0,
        parent: categoryID,
        permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: ['ViewChannel'],
                },
                {
                    id: memberID,
                    allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                },
            ],
    })
    await interaction.reply({ content: `Архив для <@${memberID}> создан - ${newChannel}`, flags: MessageFlags.Ephemeral });
    return newChannel;
} 

module.exports = { createChannel }