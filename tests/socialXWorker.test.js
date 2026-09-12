/**
 * @file socialXWorker.test.js
 * @description Tests X media validation, byte-limit fallback, and terminal failures with injected tools.
 * Never starts containers or FFmpeg and never contacts a provider.
 *
 * @module socialXWorker.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyImage, verifyVideo } from "../scripts/mediaSandbox/xPostWorker.ts";

const candidates = [{ url: "https://video.twimg.com/high.mp4" }, { url: "https://video.twimg.com/low.mp4" }];
const videoStream = { codec_type: "video", codec_name: "h264", width: 640, height: 360 };
const audioStream = { codec_type: "audio", codec_name: "aac" };

function dependencies(streams = [videoStream, audioStream], duration = "10") {
	const calls = [];
	return {
		calls,
		retrieve: async (kind, url) => {
			calls.push({ kind, url });
			return { bytes: 100, mime: "image/png" };
		},
		execute: async (command, args, options) => {
			calls.push({ command, args, options });
			assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
			assert.ok(options.timeout <= 8_000);
			return { stdout: command === "ffprobe" ? JSON.stringify({ streams, format: { duration } }) : "" };
		},
	};
}

test("X video byte overflow tries a smaller candidate but actual files still require codec and decode checks", async () => {
	const fake = dependencies();
	const retrieval = fake.retrieve;
	fake.retrieve = async (kind, url) => {
		if (url === candidates[0].url) throw new Error("size_limit");
		return retrieval(kind, url);
	};
	const result = await verifyVideo({ kind: "video", durationSeconds: 10 }, candidates, fake);
	assert.equal(result.outcome, "video_verified");
	assert.equal(result.firstTwoSecondsDecode, true);
	assert.equal(fake.calls[0].url, candidates[1].url);
	assert.equal(fake.calls.at(-1).command, "ffmpeg");
});

test("X access restrictions, rate limits, and timeouts never try another variant or expose raw failures", async () => {
	for (const outcome of ["rate_limited", "access_denied", "login_or_restriction", "timeout", "secret signed url https://example.test?token=secret"]) {
		let attempts = 0;
		const fake = dependencies();
		fake.retrieve = async () => {
			attempts++;
			throw new Error(outcome);
		};
		const result = await verifyVideo({ kind: "video" }, candidates, fake);
		assert.equal(attempts, 1);
		assert.equal(result.outcome, outcome.startsWith("secret") ? "video_validation_failed" : outcome);
		assert.ok(!JSON.stringify(result).includes("secret"));
	}
});

test("X missing audio, invalid codecs, dimensions, and duration remain explicit failures", async () => {
	for (const [streams, duration, outcome] of [
		[[videoStream], "10", "audio_unverified"],
		[[{ ...videoStream, codec_name: "hevc" }, audioStream], "10", "invalid_media"],
		[[{ ...videoStream, width: undefined }, audioStream], "10", "invalid_media"],
		[[videoStream, { ...audioStream, codec_name: "mp3" }], "10", "audio_unverified"],
		[[videoStream, audioStream], "unknown", "duration_limit"],
		[[videoStream, audioStream], "901", "duration_limit"],
	]) {
		const fake = dependencies(streams, duration);
		assert.equal((await verifyVideo({ kind: "video" }, candidates, fake)).outcome, outcome);
		assert.equal(fake.calls.filter((call) => call.kind).length, 1);
		assert.ok(!fake.calls.some((call) => call.command === "ffmpeg"));
	}
	const fake = dependencies([videoStream]);
	assert.equal((await verifyVideo({ kind: "gif" }, candidates, fake)).outcome, "video_verified");
});

test("X duration policy avoids downloads and byte fallbacks have a hard attempt bound", async () => {
	const fake = dependencies();
	assert.equal((await verifyVideo({ kind: "video", durationSeconds: 901 }, candidates, fake)).outcome, "duration_limit");
	assert.equal(fake.calls.length, 0);
	let attempts = 0;
	fake.retrieve = async () => {
		attempts++;
		throw new Error("size_limit");
	};
	assert.equal((await verifyVideo({ kind: "video" }, [...candidates, ...candidates, ...candidates], fake)).outcome, "size_limit");
	assert.equal(attempts, 4);
});

test("X original images require matching dimensions, MIME, bounded bytes, and successful local decode", async () => {
	const media = { id: "501", kind: "image", imageUrl: "https://pbs.twimg.com/media/a.png?name=orig", width: 600, height: 400 };
	const stream = { codec_name: "png", width: 600, height: 400 };
	assert.equal((await verifyImage(media, dependencies([stream]))).outcome, "image_verified");
	for (const invalid of [{ ...stream, width: 601 }, { ...stream, codec_name: "mjpeg" }, { ...stream, width: 100_000, height: 100_000 }]) {
		const fake = dependencies([invalid]);
		assert.equal((await verifyImage(media, fake)).outcome, "invalid_image");
		assert.ok(!fake.calls.some((call) => call.command === "ffmpeg"));
	}
	const oversized = dependencies([stream]);
	oversized.retrieve = async () => ({ bytes: 13 * 1_024 * 1_024, mime: "image/png" });
	assert.equal((await verifyImage(media, oversized)).outcome, "size_limit");
	const failedDecode = dependencies([stream]);
	const execution = failedDecode.execute;
	failedDecode.execute = async (command, args, options) => {
		if (command === "ffmpeg") throw new Error("private provider detail");
		return execution(command, args, options);
	};
	assert.deepEqual(await verifyImage(media, failedDecode), { mediaId: "501", outcome: "image_validation_failed" });
});
