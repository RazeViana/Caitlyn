const { SlashCommandBuilder } = require('discord.js');
const CronJob = require('cron').CronJob;
const Birthdays = require('../../models/birthdays');
const { generalChatId } = require('../../config.json');

module.exports = {
	category: 'fun',
	data: new SlashCommandBuilder()
		.setName('addbirthday')
		.setDescription('Sets a birthday reminder')
		.addUserOption(option =>
			option.setName('user')
				.setDescription('The user of the birthday you want to add')
				.setRequired(true))
		.addIntegerOption(option =>
			option.setName('day')
				.setDescription('The day of the birthday e.g. 28')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('month')
				.setDescription('The month of the birthday')
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
		.addIntegerOption(option =>
			option.setName('year')
				.setDescription('The year of the birthday e.g. 1997')
				.setRequired(true)),
	async execute(interaction) {

		const birthdayUser = interaction.options.getUser('user');
		const birthdayDay = interaction.options.getInteger('day');
		const birthdayMonth = interaction.options.getString('month');
		const birthdayYear = interaction.options.getInteger('year');

		const channel = interaction.client.channels.cache.get(generalChatId);
		const dateOfBirthFormatted = new Date(birthdayYear, birthdayMonth, birthdayDay, 12, 0, 0);

		const job = new CronJob(`0 0 11 ${birthdayDay} ${birthdayMonth} *`,
			function() {
				channel.send(`HAPPY BIRTHDAY TO ${birthdayUser.username}!`);
			});

		try {
			const birthday = await Birthdays.create({
				name: birthdayUser.username,
				dob: dateOfBirthFormatted.toISOString(),
			});

			job.start();
			return interaction.reply(`Added birthday for ${birthday.name}`);
		}
		catch (error) {
			return interaction.reply('Something went wrong with adding a birthday.');
		}
	},
};