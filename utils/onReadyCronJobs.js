const CronJob = require('cron').CronJob;
const cronJobManager = require('./cronJobManager');
const format = require('date-fns/format');
const axios = require('axios');
const Birthdays = require('../models/birthdays');
const { generalChatId, giphyAPIKey } = require('../config.json');

async function startCronJobs(client) {
	const channel = client.channels.cache.get(generalChatId);
	const allBirthdays = await Birthdays.findAll({ attributes: ['name', 'dob', 'userId'] });
	let jobsStarted = 0;
	console.log('Starting Crono Jobs for Birthday Reminders.. ' + allBirthdays.length + ' to go!');

	for (let i = 0; i < allBirthdays.length; i++) {
		const birthday = allBirthdays[i];
		const dobToDateFormat = new Date(birthday.dob);
		const day = format(dobToDateFormat, 'dd');
		const month = format(dobToDateFormat, 'MM') - 1;
		const userAgeMs = Date.now() - dobToDateFormat;
		const userAgeDate = new Date(userAgeMs);
		const userAgeYearsOld = Math.abs(userAgeDate.getUTCFullYear() - 1970);

		const job = new CronJob(`0 0 5 ${day} ${month} *`,
			async function() {
				// Get random gif from giphy
				const birthdayGiphyURL = `https://api.giphy.com/v1/gifs/random?api_key=${giphyAPIKey}&tag=birthday`;
				const response = await axios.get(birthdayGiphyURL);
				const birthdayGif = response.data.data.images.original.url;


				const birthdayEmbed = {
					title: '🎉 Birthday Reminder 🎉',
					color: 16776960,
					fields: [
						{
							name: '🍰 Name:',
							value: `<@${birthday.userId}>`,
							inline: true,
						},
						{
							name: '🎂 Date:',
							value: format(dobToDateFormat, 'MMM dd') + ', ' + userAgeYearsOld + ' years old!',
							inline: true,
						},
					],
					setImage: {
						url: birthdayGif,
					},
					footer: {
						text: 'Don\'t forget to send them my regards 🥳',
						icon_url: 'https://i.imgur.com/n8FlP3v.png',
					},
				};
				channel.send({ embeds: [birthdayEmbed] });
			});
		cronJobManager.addJob(birthday.userId, job);

		try {
			job.start();
			jobsStarted = jobsStarted + 1;
		}
		catch (error) {
			return console.log(`Something went wrong with creating cron job for ${birthday.name}.`);
		}
	}
	console.log('Jobs started: ' + jobsStarted);
}

module.exports = startCronJobs;