const CronJob = require('cron').CronJob;
const format = require('date-fns/format');
const Birthdays = require('../models/birthdays');
const { generalChatId } = require('../config.json');

async function startCronJobs(client) {
	const channel = client.channels.cache.get(generalChatId);
	const allBirthdays = await Birthdays.findAll({ attributes: ['name', 'dob'] });

	for (let i = 0; i < allBirthdays.length; i++) {
		const birthday = allBirthdays[i];
		const dobToDateFormat = new Date(birthday.dob);
		const day = format(dobToDateFormat, 'dd');
		const month = format(dobToDateFormat, 'MM');

		const job = new CronJob(`0 0 11 ${day} ${month} *`,
			function() {
				channel.send(`HAPPY BIRTHDAY TO ${birthday.name}!`);
			});

		try {
			job.start();
			console.log(`Cron Job started for ${birthday.name} for every ${day} (day) on ${month} (month) of every year`);
		}
		catch (error) {
			return console.log(`Something went wrong with creating cron job for ${birthday.name}.`);
		}
	}
}

module.exports = startCronJobs;