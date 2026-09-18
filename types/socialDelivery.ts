/**
 * @file socialDelivery.ts
 * @description Defines durable social jobs and the bounded local worker wire protocol.
 * Separates Discord/database identities from provider content and downloaded bytes.
 *
 * @module socialDelivery
 */

import type { InstagramFailureReason, SocialMetadataProvider, SocialPost, XPost, XPostDiagnostic } from "./socialMedia.js";
import type { SocialMediaAttachment } from "../core/socialPostRender.js";

export interface SocialJob {
	id: string;
	guild_id: string;
	channel_id: string;
	source_id: string;
	author_id: string;
	source_hash: string;
	post_id: string;
	url: string;
	status: "queued" | "processing" | "sending" | "uncertain" | "sent" | "removing" | "cancelled" | "failed";
	attempts: number;
	lease_token: string;
	cancel_requested: boolean;
	message_id: string | null;
	source_cleanup: "preserve" | "pending" | "deleting" | "deleted" | "retained";
	replacement_ready: boolean;
	sensitive: boolean;
}

export interface SocialWorkerRequest {
	version: 1;
	url: string;
	attachmentBytes: number;
	totalBytes: number;
	allowSensitive?: boolean;
}

export type SocialWorkerFailure = { outcome: "unavailable" | "unsupported" | "restricted" | "rate_limited" | "worker_unavailable" | "invalid_response" | "timeout";
	diagnostic?: XPostDiagnostic; instagramReason?: InstagramFailureReason; provider?: SocialMetadataProvider };

export type SocialWorkerResult = { outcome: "ready" | "partial"; post: SocialPost; files: SocialMediaAttachment[]; mediaFailures?: string[]; provider?: SocialMetadataProvider }
	| SocialWorkerFailure;

export type SocialMetadataRequest = Pick<SocialWorkerRequest, "version" | "url" | "allowSensitive">;

/** Metadata readiness is not a delivery result and never authorizes source deletion. */
export type SocialMetadataResult = { version: 1; purpose: "metadata"; provider: "fxembed"; outcome: "ready" | "partial"; post: XPost }
	| SocialWorkerFailure;

export type SocialWorkerOperation = "delivery" | "metadata";

export interface SocialChannelSetting {
	channel_id: string;
	enabled: boolean;
}
