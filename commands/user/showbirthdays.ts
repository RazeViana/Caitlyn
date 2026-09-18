/**
 * @file showbirthdays.ts
 * @description Displays saved birthdays by month with today's birthdays and upcoming calendar dates.
 * Adds an optional GIF through a bounded request and keeps embed text within Discord limits.
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
import { logData } from "../../core/dataLog.js";
import { nextBirthday } from "../../core/birthdayDate.js";
import { truncate } from "../../core/textLimits.js";
import { deferInteraction, respondWithError } from "../../core/interactionResponse.js";
import { getFeatureConfiguration } from "../../core/environment.js";

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_ENDPOINT = `https://api.giphy.com/v1/gifs/random?api_key=${encodeURIComponent(GIPHY_API_KEY ?? "")}&tag=birthday`;

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
	dob: Date | string;
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
	year: number;
}

export interface ShowBirthdaysDependencies {
	giphyEnabled?: () => boolean;
	fetch: (url: string) => Promise<FetchResponse>;
	query: (...args: [string, ...unknown[]]) => Promise<{ rows: BirthdayRow[] }>;
}

const defaultShowBirthdaysDependencies: ShowBirthdaysDependencies = {
	giphyEnabled: () => getFeatureConfiguration().giphy.enabled,
	fetch: async (url) => fetch(url, { signal: AbortSignal.timeout(3_000) }),
	query: (...args) => Reflect.apply(pool.query, pool, args) as Promise<{ rows: BirthdayRow[] }>,
};

export const category = "user";
export const requiresDatabase = true;
export const data = new SlashCommandBuilder()
	.setName("showbirthdays")
	.setDescription("🎉 View all saved birthdays grouped by month!");

export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: ShowBirthdaysDependencies = defaultShowBirthdaysDependencies,
): Promise<void> {
	// Defer the reply to give the bot time to process
	if (!interaction.guild) {
		await respondWithError(interaction, "Use this command in a server.");
		return;
	}
	if (!await deferInteraction(interaction)) return;

	const guild = interaction.guild;
	const now = new Date();
	let randomGIF = null;

	try {
		// Fetch random gif from Giphy API
		if (dependencies.giphyEnabled?.() !== false) {
			const giphyResponse = await dependencies.fetch(GIPHY_ENDPOINT);

			const giphyData = await giphyResponse.json() as GiphyResponse;

			if (!giphyResponse.ok) {
				logger.error(
					"Failed to fetch GIF from Giphy API:",
					giphyResponse.statusText,
				);
			}

			randomGIF = giphyData.data?.images?.original?.url;
			logData("Checked for a birthday GIF; link and image content are not included in logs", {
				server: interaction.guildId, count: randomGIF ? 1 : 0,
			});
		}
	}
	catch {
		logger.warn("Birthday GIF unavailable; continuing without it");
	}

	try {
		// Fetch all birthdays from the database
		const res = await dependencies.query("SELECT discord_id, name, dob::text FROM discord.birthdays");
		logData("Read saved birthdays for the birthday list; dates are not included in logs", {
			server: interaction.guildId, actor: interaction.user?.id, count: res.rows.length,
		});
		// If no birthdays are found, return a message
		if (res.rows.length === 0) {
			await interaction.editReply("😢 No birthdays found!");
			return;
		}

		// Group birthdays by month
		const months: BirthdayDisplay[][] = Array.from({ length: 12 }, () => []);

		for (const row of res.rows) {
			const dob = typeof row.dob === "string" ? parseISO(row.dob) : row.dob;
			if (!Number.isFinite(dob.getTime())) continue;
			const bdayThisYear = nextBirthday(dob, now);

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
				year: bdayThisYear.getFullYear(),
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
		let remainingText = 4_500;
		for (let offset = 0; offset < 12; offset++) {
			const monthIndex = (currentMonthIndex + offset) % 12;
			const birthdays = months[monthIndex];
			if (birthdays.length === 0 || remainingText <= 0) continue;

			// Sort birthdays within the month by day
			birthdays.sort((a, b) => a.day - b.day);

			// Determine which year to show
			const years = [...new Set(birthdays.map((birthday) => birthday.year))].sort();
			const monthYear = years.join(" / ");

			const value = truncate(birthdays.map((b) => b.text).join("\n"), Math.min(1_000, remainingText));
			remainingText -= value.length;
			embed.addFields({
				name: `📆 ${monthNames[monthIndex]} ${monthYear}`,
				value,
				inline: false,
			});
		}

		// Send the embed
		await interaction.editReply({ embeds: [embed] });
	}
	catch (error) {
		logger.error("❌ Error fetching birthdays:", error);
		await respondWithError(interaction, "Could not fetch birthdays. Please try again shortly.");
	}
}
