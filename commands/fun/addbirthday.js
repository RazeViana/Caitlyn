const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const CronJob = require('cron').CronJob;
const cronJobManager = require('../../utils/cronJobManager');
const format = require('date-fns/format');
const Birthdays = require('../../models/birthdays');
const { generalChatId, giphyAPIKey } = require('../../config.json');

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

		// Figure out dates
		const birthdayUser = interaction.options.getUser('user');
		const birthdayDay = interaction.options.getInteger('day');
		const birthdayMonth = interaction.options.getString('month') - 1;
		const birthdayYear = interaction.options.getInteger('year');
		const dateOfBirthFormatted = new Date(birthdayYear, birthdayMonth, birthdayDay, 12, 0, 0);
		const nextBirthday = new Date(today.getFullYear(), month, day);
		let userAgeYearsOld = nextBirthday.getFullYear() - dobToDateFormat.getFullYear();
		if (today < nextBirthday) {
			userAgeYearsOld--;
		}

		const generalChannel = interaction.client.channels.cache.get(generalChatId);

		// First Check if birthday already exists for that user
		const existingBirthday = await Birthdays.findOne({ where: { userId: birthdayUser.id } });
		if (existingBirthday) {
			return interaction.reply({ content: `Birthday is already set for ${birthdayUser.username}`, ephemeral: true });
		}

		const job = new CronJob(`0 0 4 ${birthdayDay} ${birthdayMonth} *`,
			async function() {
				// Get random gif from giphy
				const birthdayGiphyURL = `https://api.giphy.com/v1/gifs/random?api_key=${giphyAPIKey}&tag=birthday`;
				const response = await axios.get(birthdayGiphyURL);
				const birthdayGif = response.data.data.images.original.url;

				const birthdayEmbed = {
					title: `🎉 Birthday Reminder <#${generalChatId}>! 🎉`,
					color: 16776960,
					fields: [
						{
							name: '🍰 Name:',
							value: `<@${birthdayUser.id}>`,
							inline: true,
						},
						{
							name: '🎂 Date:',
							value: format(dateOfBirthFormatted, 'MMM dd') + ', ' + userAgeYearsOld + ' years old!',
							inline: true,
						},
					],
					image: {
						url: birthdayGif,
					},
					footer: {
						text: 'Don\'t forget to send them my regards 🥳',
						icon_url: 'https://i.imgur.com/n8FlP3v.png',
					},
				};

				generalChannel.send({ embeds: [birthdayEmbed] });
			});

		cronJobManager.addJob(birthdayUser.id, job);
		try {
			const birthday = await Birthdays.create({
				userId: birthdayUser.id,
				name: birthdayUser.username,
				dob: dateOfBirthFormatted.toISOString(),
			});

			job.start();
			return interaction.reply({ content:`Added birthday for ${birthday.name}. It is ready and set for ${format(dateOfBirthFormatted, 'dd MMMM')}`, ephemeral: true });
		}
		catch (error) {
			return interaction.reply({ content:'Something went wrong with adding a birthday.', ephemeral: true });
		}
	},
};