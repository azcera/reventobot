const { ActionRowBuilder, ButtonBuilder, ButtonStyle, roleMention } = require('discord.js');
const { splitName } = require('../commands/utility/splitName');
const { autoRole, messagesChannelID, adminRoles } = require('../config.json')


module.exports = (client) => {
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            const guild = newMember.guild;

            // Проверяем, была ли роль только что добавлена
            const hadRoleBefore = oldMember.roles.cache.some(role => role.id === autoRole);
            const hasRoleNow = newMember.roles.cache.some(role => role.id === autoRole);

            if (!hadRoleBefore && hasRoleNow) {
                // роль была добавлена

                const displayName = newMember.displayName;
                const splittedData = splitName(displayName);
                if (!splittedData) return;

                const channels = guild.channels.cache;
                const channelName = `archive-${splittedData.name}-${splittedData.stat}`;

                const existingChannel = channels.find((channel) => channel.name === channelName);

                if (!existingChannel) {
                    const messagesChannel = guild.channels.cache.get(messagesChannelID);
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`create_archive:${splittedData.name}:${splittedData.stat}:${newMember.id}`)
                                .setLabel('Да')      
                                .setStyle(ButtonStyle.Success),  
                            new ButtonBuilder()
                                .setCustomId(`cancel_create:${splittedData.name}:${splittedData.stat}:${newMember.id}`)
                                .setLabel('Нет')
                                .setStyle(ButtonStyle.Danger)
                    )

                    if (messagesChannel && messagesChannel.isTextBased()) {
                        messagesChannel.send({content: `${adminRoles.map((e) => roleMention(e))} Создать для <@${newMember.id}> архив - \`${channelName}\`?`, components: [row]});
                    }

                }


      
                
            }
        } catch (err) {
            console.error("Ошибка при создании архива:", err);
        }
    });
};