/**
 * @file showbirthdays.js
 * @description This module defines a Discord slash command for displaying all saved birthdays grouped by month.
 * It fetches birthday data from a PostgreSQL database, organizes it by month, and displays it in an embed message.
 * The command highlights birthdays happening today and calculates the number of days remaining for upcoming birthdays.
 *
 * Additionally, it fetches a random birthday-themed GIF from the Giphy API to enhance the visual appeal of the embed.
 * If no birthdays are found, it informs the user accordingly.
 *
 * @module showbirthdays
 */

import {
	SlashCommandBuilder,
	EmbedBuilder,
	userMention,
	type ChatInputCommandInteraction,
} from "discord.js";
import { pool } from "../../core/createPGPool.js";
import {
	format,
	isSameDay,
	parseISO,
	getMonth,
	differenceInCalendarDays,
} from "date-fns";
import logger from "../../core/logger.js";

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_ENDPOINT = `https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_API_KEY}&tag=birthday`;

const monthNames = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

interface BirthdayRow {
	discord_id: string;
	dob: Date;
	name: string;
}

interface GiphyResponse {
	data?: {
		images?: {
			original?: {
				url?: string;
			};
		};
	};
}

interface FetchResponse {
	json: () => Promise<unknown>;
	ok: boolean;
	statusText: string;
}

interface BirthdayDisplay {
	day: number;
	text: string;
}

export interface ShowBirthdaysDependencies {
	fetch: (url: string) => Promise<FetchResponse>;
	query: (...args: [string, ...unknown[]]) => Promise<{ rows: BirthdayRow[] }>;
}

const defaultShowBirthdaysDependencies: ShowBirthdaysDependencies = {
	fetch: async (url) => fetch(url),
	query: (...args) => Reflect.apply(pool.query, pool, args) as Promise<{ rows: BirthdayRow[] }>,
};

export const category = "user";
export const data = new SlashCommandBuilder()
	.setName("showbirthdays")
	.setDescription("🎉 View all saved birthdays grouped by month!");

export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: ShowBirthdaysDependencies = defaultShowBirthdaysDependencies,
): Promise<void> {
	// Defer the reply to give the bot time to process
	await interaction.deferReply();

	const guild = interaction.guild;
	const now = new Date();
	let randomGIF = null;

	try {
		// Fetch random gif from Giphy API
		const giphyResponse = await dependencies.fetch(GIPHY_ENDPOINT);

		const giphyData = await giphyResponse.json() as GiphyResponse;

		if (!giphyResponse.ok) {
			logger.error(
				"Failed to fetch GIF from Giphy API:",
				giphyResponse.statusText,
			);
		}

		randomGIF = giphyData.data?.images?.original?.url;
	}
	catch (error) {
		logger.error("Error fetching GIF:", error);
	}

	try {
		// Fetch all birthdays from the database
		const res = await dependencies.query("SELECT * FROM discord.birthdays");
		// If no birthdays are found, return a message
		if (res.rows.length === 0) {
			await interaction.editReply("😢 No birthdays found!");
			return;
		}

		// Group birthdays by month
		const months: BirthdayDisplay[][] = Array.from({ length: 12 }, () => []);

		for (const row of res.rows) {
			const dob = parseISO(row.dob.toISOString());
			const bdayThisYear = new Date(
				now.getFullYear(),
				dob.getMonth(),
				dob.getDate(),
			);

			// If birthday already passed this year, move to next
			if (bdayThisYear < now) {
				bdayThisYear.setFullYear(now.getFullYear() + 1);
			}

			const isToday = isSameDay(bdayThisYear, now);
			const daysUntil = differenceInCalendarDays(bdayThisYear, now);
			const member = await guild!.members
				.fetch(row.discord_id)
				.catch(() => null);

			const mention = member
				? `${userMention(row.discord_id)} (${member.displayName})`
				: `Unknown (${row.name})`;

			const display = isToday
				? `🎉 **Today!** - ${mention}`
				: `${format(
					dob,
					"dd MMM yyyy",
					  )} — ⏳ ${daysUntil} day(s) left • ${mention}`;

			months[getMonth(dob)].push({
				day: dob.getDate(),
				text: display,
			});
		}

		// Build embed
		const embed = new EmbedBuilder()
			.setTitle("🎂 Birthday Calendar")
			.setDescription("Here are all the saved birthdays")
			.setColor(0xff80ab)
			.setThumbnail(
				`${randomGIF ? randomGIF : "https://i.imgur.com/4qijkuw.jpeg"}`,
			)
			.setFooter({
				text: `Requested by ${interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		const currentMonthIndex = now.getMonth();

		// Loop through months starting from the current month
		for (let offset = 0; offset < 12; offset++) {
			const monthIndex = (currentMonthIndex + offset) % 12;
			const birthdays = months[monthIndex];
			if (birthdays.length === 0) continue;

			// Sort birthdays within the month by day
			birthdays.sort((a, b) => a.day - b.day);

			// Determine which year to show
			const monthYear =
					monthIndex < currentMonthIndex
						? now.getFullYear() + 1
						: now.getFullYear();

			embed.addFields({
				name: `📆 ${monthNames[monthIndex]} ${monthYear}`,
				value: birthdays.map((b) => b.text).join("\n"),
				inline: false,
			});
		}

		// Send the embed
		await interaction.editReply({ embeds: [embed] });
	}
	catch (error) {
		logger.error("❌ Error fetching birthdays:", error);
		await interaction.editReply("An error occurred fetching birthdays.");
	}
}
