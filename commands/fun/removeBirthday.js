const { SlashCommandBuilder } = require('discord.js');
const cronJobManager = require('../../utils/cronJobManager');
const Birthdays = require('../../models/birthdays');

module.exports = {
	cooldown: 10,
	category: 'fun',
	data: new SlashCommandBuilder()
		.setName('removebirthday')
		.setDescription('Removes a birthday')
		.addUserOption(option =>
			option.setName('user')
				.setDescription('The user of the birthday you want to remove')
				.setRequired(true)),
	async execute(interaction) {

		const birthdayUser = interaction.options.getUser('user');

		try {
			const deleteResult = await Birthdays.destroy({ where: { userId: birthdayUser.id } });

			if (deleteResult) {
				cronJobManager.stopJob(birthdayUser.id);
				return interaction.reply({ content: `User ${birthdayUser.username}'s birthday was removed`, ephemeral: true });
			}
			else {
				return interaction.reply({ content: `User ${birthdayUser.username} was not found`, ephemeral: true });
			}

		}
		catch (error) {
			console.error('Error fetching birthdays:', error);
			return interaction.reply('An error occurred while fetching birthdays.');
		}
	},
};