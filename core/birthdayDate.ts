/**
 * @file birthdayDate.ts
 * @description Validates date-only birthdays and calculates their next calendar occurrence.
 * Handles leap days without shifting stored dates across timezones.
 *
 * @module birthdayDate
 */

/** Birthdays are calendar dates, never timezone-adjusted timestamps. */
export function birthdayDate(year: number, month: number, day: number): string | null {
	if (![year, month, day].every(Number.isInteger) || year < 1900 || year > new Date().getFullYear()) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function nextBirthday(dob: Date, now: Date): Date {
	if (!Number.isFinite(dob.getTime()) || !Number.isFinite(now.getTime())) throw new Error("Invalid birthday date");
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	let year = today.getFullYear();
	for (;;) {
		const candidate = new Date(year, dob.getMonth(), dob.getDate());
		// February 29 is celebrated on February 29; skip non-leap years.
		if (candidate.getMonth() === dob.getMonth() && candidate >= today) return candidate;
		year++;
	}
}
