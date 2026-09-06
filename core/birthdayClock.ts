/**
 * @file birthdayClock.ts
 * @description Resolves the reminder timezone and calculates date-only delivery windows.
 * Preserves host-local scheduling when no explicit timezone is configured.
 *
 * @module birthdayClock
 */

export function birthdayTimezone(value = process.env.BIRTHDAY_TIMEZONE): string {
	const timezone = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
	return timezone;
}

export function birthdayWindow(now: Date, timezone: string): { date: string; due: boolean } {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)!.value;
	return { date: `${part("year")}-${part("month")}-${part("day")}`, due: Number(part("hour")) >= 9 };
}
