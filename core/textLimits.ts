/**
 * @file textLimits.ts
 * @description Truncates and splits text to fit Discord output limits.
 * Preserves UTF-16 surrogate pairs and caps the total length of chunked AI replies.
 *
 * @module textLimits
 */

export function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

export function messageChunks(text: string): string[] {
	const chunks: string[] = [];
	let chunk = "";
	for (const character of truncate(text, 6_000)) {
		if (chunk.length + character.length > 2_000) {
			chunks.push(chunk);
			chunk = "";
		}
		chunk += character;
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}
