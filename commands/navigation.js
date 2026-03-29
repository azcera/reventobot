const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, userMention, Guild, channelMention, MessageFlags, roleMention } = require('discord.js');
const { mentionedRole, navigationButttons } = require('../config.json')


module.exports = {
	data: new SlashCommandBuilder()
        .setName('navigation')
        .setDescription('Создает навигацию'),
	async execute(interaction) {
            let components = []
            let j = 0;
            row = [];
            for (let i = 0; i < navigationButttons.length; i++) {
                if (j === 4) {
                    j = 0;
                    components = [...components, new ActionRowBuilder()
                        .addComponents(row)];
                    row = [];
                }
                row = [...row, new ButtonBuilder()
                    .setLabel(navigationButttons[i].label)
                    .setStyle(ButtonStyle.Link)
                    .setURL(navigationButttons[i].link)
                ]                
                j++;
                
            }
            if (row.length > 0) {
                components = [...components, new ActionRowBuilder()
                    .addComponents(row)];
            }
            
            await interaction.reply({content: `||${roleMention(mentionedRole)}||`,allowedMentions: { roles: [mentionedRole] }, components: components})
	},
};