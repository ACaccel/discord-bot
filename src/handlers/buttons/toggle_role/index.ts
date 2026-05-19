import type { 
    ButtonInteraction,
    Guild,
    GuildMember} from 'discord.js';
import {
    MessageFlags,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { ButtonHandler } from '@button';

export default class toggle_role extends ButtonHandler {
    public override async execute(interaction: ButtonInteraction, bot: BaseBot): Promise<void> {
        const member = interaction.member as GuildMember;
        const guild = interaction.guild as Guild;
        const roleId = interaction.customId.split("|")[1];
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            await interaction.reply({
                content: `Role not found.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }
    
        // assign role or remove role
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId);
            await interaction.reply({
                content: `Removed role ${role.name}.`,
                flags: MessageFlags.Ephemeral
            });
        } else {
            await member.roles.add(roleId);
            await interaction.reply({
                content: `Added role ${role.name}.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}