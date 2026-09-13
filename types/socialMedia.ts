/**
 * @file socialMedia.ts
 * @description Defines canonical social links and bounded, separately attributed X posts.
 * Metadata readiness does not imply that media has been downloaded or delivered.
 *
 * @module socialMedia
 */

export type SocialPlatform = "x" | "instagram" | "reddit" | "tiktok";

export type XMetadataProvider = "fxembed";

export interface SocialLink {
	platform: SocialPlatform;
	kind: "post" | "share";
	id: string;
	key: string;
	url: string;
}

export type XPostIssue = "missing_author" | "incomplete_text" | "invalid_media" | "unsupported_media"
	| "media_limit" | "quote_unavailable" | "nested_quote_omitted" | "unsupported_card";

export interface XVideoVariant {
	url: string;
	bitrate: number;
	width?: number;
	height?: number;
}

export interface XPostMedia {
	id: string;
	kind: "image" | "video" | "gif";
	imageUrl?: string;
	alt?: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
	variants: XVideoVariant[];
}

export interface XPost {
	sensitive?: boolean;
	id: string;
	url: string;
	author: { name: string; handle?: string };
	text: string;
	textComplete: boolean;
	media: XPostMedia[];
	issues: XPostIssue[];
	quote?: { state: "available"; post: XPost } | { state: "unavailable"; id?: string };
}

/** Closed vocabulary only: provider text, URLs, and arbitrary reason/type strings must never escape. */
export interface XPostDiagnostic {
	stage: "metadata";
	responseType: "Tweet" | "TweetUnavailable" | "TweetTombstone" | "TweetWithVisibilityResults" | "TweetPreviewDisplay" | "FxStatus" | "FxTombstone" | "missing" | "unknown";
	reason: "login_required" | "age_required" | "protected" | "deleted" | "unavailable" | "subscription_required"
		| "unknown_tombstone" | "unknown_unavailable" | "unexpected_response" | "identity_mismatch" | "sensitive_disabled" | "author_unavailable";
	source: "reason_code" | "tombstone_text" | "response_shape" | "policy";
	hasLegacy: boolean;
	hasTombstoneText: boolean;
}

export type XPostResult = { outcome: "ready" | "partial"; post: XPost }
	| { outcome: "unavailable" | "restricted" | "invalid_response"; diagnostic?: XPostDiagnostic };
