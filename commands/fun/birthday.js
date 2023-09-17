const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	category: 'fun',
	data: new SlashCommandBuilder()
		.setName('birthday')
		.setDescription('Sets a birthday reminder')
		.addStringOption(option =>
			option.setName('name')
				.setDescription('The name of the person')
				.setRequired(true))
		.addChannelOption(option =>
			option.setName('day')
				.setDescription('The day of the birthday e.g. 28')
				.setRequired(true))
		.addChannelOption(option =>
			option.setName('month')
				.setDescription('The month of the birthday e.g. 2')
				.setRequired(true)
				.addChoices(
					{ name: 'January', value: '1' },
					{ name: 'February', value: '2' },
					{ name: 'March', value: '3' },
					{ name: 'April', value: '4' },
					{ name: 'May', value: '5' },
					{ name: 'June', value: '6' },
					{ name: 'July', value: '7' },
					{ name: 'August', value: '8' },
					{ name: 'September', value: '9' },
					{ name: 'October', value: '10' },
					{ name: 'November', value: '11' },
					{ name: 'December', value: '12' }))
		.addChannelOption(option =>
			option.setName('year')
				.setDescription('The year of the birthday e.g. 1997')
				.setRequired(true)),
	async execute(interaction) {


		await interaction.reply('Birthday set');
	},
};