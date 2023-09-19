const { Events } = require('discord.js');
const Birthdays = require('../models/birthdays');
const startCronJobs = require('../utils/onReadyCronJobs');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		Birthdays.sync();
		startCronJobs(client);
		console.log(`Ready! Logged in as ${client.user.tag}`);
	},
};