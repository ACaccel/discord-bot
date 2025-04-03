import { ButtonInteraction, Guild, GuildMember } from "discord.js";
import { BaseBot } from "@dcbotTypes";

export const toggle_role = async (interaction: ButtonInteraction, bot: BaseBot) => {
    const member = interaction.member as GuildMember;
    const guild = interaction.guild as Guild;
    const roleId = interaction.customId.split("|")[1];
    const role = guild.roles.cache.get(roleId);
    if (!role) {
        await interaction.reply({
            content: `Role not found.`,
            ephemeral: true
        });
        return;
    }

    // assign role or remove role
    if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        await interaction.reply({
            content: `Removed role ${role.name}.`,
            ephemeral: true
        });
    } else {
        await member.roles.add(roleId);
        await interaction.reply({
            content: `Added role ${role.name}.`,
            ephemeral: true
        });
    }
}