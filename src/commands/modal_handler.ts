import { BaseBot } from '@dcbotTypes';
import { ModalSubmitInteraction } from 'discord.js';

export const modal1 = (interaction: ModalSubmitInteraction, bot: BaseBot) => {
    const favoriteColor = interaction.fields.getTextInputValue('favoriteColorInput');
	const hobbies = interaction.fields.getTextInputValue('hobbiesInput');
	console.log({ favoriteColor, hobbies });

    interaction.reply({ content: 'Thank you for submitting the form!', ephemeral: true });
};