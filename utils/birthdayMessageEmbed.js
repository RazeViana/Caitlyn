/**
 * @file birthdayMessageEmbed.js
 * @description This module provides a scheduled event handler for celebrating user birthdays in a Discord server.
 * It fetches user birthdays from a PostgreSQL database, checks if any birthdays match the current date, and sends
 * a celebratory message to a specified text channel in the Discord server.
 *
 * The birthday message includes random celebratory emojis and mentions the users whose birthdays are being celebrated.
 * The module ensures that the target channel is a valid text channel before sending the message.
 *
 * @module birthdayMessageEmbed
 */

const { TextChannel, userMention } = require("discord.js");
const { pool } = require("../core/createPGPool");
const { format } = require("date-fns");

require("dotenv").config();

const GUILD_ID = process.env.GUILD_ID;
const GENERAL_CHAT_ID = process.env.GENERAL_CHAT_ID;

async function birthdayMessageEmbed(client) {
	const cakeEmojis = ["🎂", "🍰", "🧁", "🎉", "🎊", "🥳", "🎈"];
	const randomEmoji = () =>
		cakeEmojis[Math.floor(Math.random() * cakeEmojis.length)];

	const today = format(new Date(), "MM-dd");

	// Fetch all birthdays from the database
	const res = await pool.query(`SELECT * FROM discord.birthdays`);

	// Filter the birthdays to find those that match today's date
	const birthdayPeople = res.rows.filter((row) => {
		const dob = new Date(row.dob);
		const dobStr = format(dob, "MM-dd");
		return dobStr === today;
	});

	// If no birthdays are found, return early
	if (!birthdayPeople.length) return;

	// Fetch the guild and channel to send the birthday message
	const guild = await client.guilds.fetch(GUILD_ID);
	const channel = await guild.channels.fetch(GENERAL_CHAT_ID);

	// Check if the channel is a TextChannel
	if (!(channel instanceof TextChannel)) return;

	// Set the mentions for the birthday people
	const mentions = birthdayPeople
		.map(
			(p) => `${randomEmoji()} ${userMention(p.discord_id)} ${randomEmoji()}`
		)
		.join("\n");

	// Send the birthday message to the channel
	await channel.send({
		content: [
			`🎉🎂 **It's Party Time!** 🎂🎉`,
			`Today we're celebrating these fellas:`,
			`\n${mentions}`,
			`\nSend them my regards 🥳`,
		].join("\n"),
	});
}

module.exports = birthdayMessageEmbed;
