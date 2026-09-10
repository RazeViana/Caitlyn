/**
 * @file socialMedia.ts
 * @description Defines canonical social-post and unresolved share-link identities.
 * These contracts do not imply that a post or its media can be retrieved.
 *
 * @module socialMedia
 */

export type SocialPlatform = "x" | "instagram" | "reddit" | "tiktok";

export interface SocialLink {
	platform: SocialPlatform;
	kind: "post" | "share";
	id: string;
	key: string;
	url: string;
}
