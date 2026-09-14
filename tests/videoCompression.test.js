/**
 * @file videoCompression.test.js
 * @description Tests sandbox compression budgets, fixed process arguments and complete-media verification.
 * Injects filesystem/process operations; never runs FFmpeg or accesses a provider.
 *
 * @module videoCompression.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { compressVideo, MAX_VIDEO_SOURCE_BYTES, videoCompressionPlan } from "../scripts/mediaSandbox/videoCompression.ts";

const limit = 256 * 1_024;
function metadata(width = 1280, height = 720, duration = 10) {
	return { format: { duration: String(duration) }, streams: [
		{ codec_type: "video", codec_name: "h264", width, height, duration: String(duration) },
		{ codec_type: "audio", codec_name: "aac", duration: String(duration) },
	] };
}
function fixture() {
	const calls = [];
	const before = metadata();
	const after = metadata(240, 134);
	return { calls, before, after,
		stat: async (path) => ({ size: path === "/tmp/x-video.mp4" ? 2_000_000 : 200_000, isFile: () => true }),
		rename: async (...args) => { calls.push(["rename", ...args]); },
		execute: async (command, args, options) => {
			calls.push([command, args, options]);
			return { stdout: command === "ffprobe" ? JSON.stringify(args.at(-1) === "/tmp/x-video.mp4" ? before : after) : "" };
		},
	};
}

test("compression plans bound duration, upload size, quality and output dimensions", () => {
	for (const [duration, bytes] of [[0, limit], [NaN, limit], [Infinity, limit], [901, limit], [10, 100], [10, 8 * 1024 * 1024 + 1], [10, 1.5]]) {
		assert.equal(videoCompressionPlan(duration, bytes), undefined);
	}
	assert.equal(videoCompressionPlan(900, limit), undefined);
	assert.deepEqual(videoCompressionPlan(654, 8 * 1024 * 1024), { videoRate: 55221, audioRate: 32000, side: 240, fps: 15 });
	assert.equal(videoCompressionPlan(10, 8 * 1024 * 1024).videoRate, 1_000_000);
});

test("compression uses fixed local paths, two bounded passes, full audio/video decode and atomic replacement", async () => {
	const f = fixture();
	assert.deepEqual(await compressVideo(limit, f), { outcome: "video_verified", bytes: 200_000, compressed: true });
	const commands = f.calls.filter(([name]) => name !== "rename");
	assert.deepEqual(commands.map(([name]) => name), ["ffprobe", "ffmpeg", "ffmpeg", "ffprobe", "ffmpeg"]);
	for (const [, args, options] of commands) {
		assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
		assert.ok(options.timeout <= 20_000);
		assert.equal(options.maxBuffer, 32_768);
		assert.ok(!args.some((arg) => /https?:|secret|cookie/.test(arg)));
		assert.ok(!args.includes("-t") && !args.includes("-ss") && !args.includes("-shortest"));
	}
	assert.equal(commands[1][1][commands[1][1].indexOf("-pass") + 1], "1");
	assert.equal(commands[2][1][commands[2][1].indexOf("-pass") + 1], "2");
	assert.equal(commands[2][1][commands[2][1].indexOf("-fs") + 1], String(limit));
	assert.deepEqual(f.calls.at(-1), ["rename", "/tmp/compact-video.mp4", "/tmp/x-video.mp4"]);
});

test("compression rejects oversized/non-file inputs and impossible budgets before encoding", async () => {
	for (const source of [{ size: MAX_VIDEO_SOURCE_BYTES + 1, isFile: () => true }, { size: 0, isFile: () => true }, { size: 123, isFile: () => false }]) {
		const f = fixture();
		f.stat = async () => source;
		assert.equal((await compressVideo(limit, f)).outcome, "size_limit");
		assert.equal(f.calls.length, 0);
	}
	const f = fixture();
	Object.assign(f.before, metadata(1280, 720, 900));
	assert.equal((await compressVideo(limit, f)).outcome, "size_limit");
	assert.ok(!f.calls.some(([name]) => name === "ffmpeg"));
});

test("compression rejects unsupported streams, dimensions and incomplete audio metadata", async () => {
	for (const mutate of [
		(value) => { value.streams.pop(); }, (value) => { value.streams.push({ codec_type: "subtitle" }); },
		(value) => { value.streams[0].codec_name = "hevc"; }, (value) => { value.streams[1].codec_name = "mp3"; },
		(value) => { value.streams[0].width = 7680; }, (value) => { value.streams[0].duration = undefined; },
		(value) => { value.streams[1].duration = "3"; }, (value) => { value.format.duration = "NaN"; },
	]) {
		const f = fixture();
		mutate(f.before);
		assert.equal((await compressVideo(limit, f)).outcome, "video_validation_failed");
		assert.ok(!f.calls.some(([name]) => name === "ffmpeg" || name === "rename"));
	}
});

test("oversized, shortened, corrupt or timed-out encoded output never replaces the source", async () => {
	for (const kind of ["oversized", "shortened", "truncated_audio", "bad_dimensions", "decode", "timeout"]) {
		const f = fixture();
		if (kind === "oversized") f.stat = async () => ({ size: limit + 1, isFile: () => true });
		if (kind === "shortened") Object.assign(f.after, metadata(320, 180, 9));
		if (kind === "truncated_audio") f.after.streams[1].duration = "9";
		if (kind === "bad_dimensions") f.after.streams[0].width = 1280;
		const run = f.execute;
		f.execute = async (command, args, options) => {
			if ((kind === "timeout" && args.includes("-pass")) || (kind === "decode" && command === "ffmpeg" && !args.includes("-pass"))) throw Object.assign(new Error("private raw diagnostics"), { killed: kind === "timeout" });
			return run(command, args, options);
		};
		assert.equal((await compressVideo(limit, f)).outcome, kind === "oversized" ? "size_limit" : kind === "timeout" ? "compression_timeout"
			: ["shortened", "bad_dimensions"].includes(kind) ? "compression_incomplete" : "video_validation_failed");
		assert.ok(!f.calls.some(([name]) => name === "rename"));
	}
});
