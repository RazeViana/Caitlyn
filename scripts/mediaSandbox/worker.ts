/**
 * @file worker.ts
 * @description Exercises a pinned extractor inside a network-none, credential-free container.
 * Uses the restricted Unix gateway, validates downloaded media, and emits summaries only.
 *
 * @module worker
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { connect, createServer } from "node:net";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);

async function deniedConnection(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		const finish = (denied: boolean): void => {
			clearTimeout(timer);
			socket.destroy();
			resolve(denied);
		};
		const timer = setTimeout(() => { finish(true); }, 1_000);
		socket.once("error", () => { finish(true); });
		socket.once("connect", () => { finish(false); });
	});
}

async function gatewayDenies(authority: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect("/ipc/proxy.sock");
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, 2_000);
		socket.once("error", () => {
			clearTimeout(timer);
			resolve(false);
		});
		socket.once("connect", () => { socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`); });
		socket.once("data", (data) => {
			clearTimeout(timer);
			resolve(data.toString().startsWith("HTTP/1.1 403"));
			socket.destroy();
		});
	});
}

async function isolationCheck(): Promise<void> {
	const checks = {
		unprivileged: process.getuid?.() === 1000,
		noCredentials: !["TOKEN", "PGPASSWORD", "WEBUI_API_KEY", "SSH_AUTH_SOCK", "AWS_SECRET_ACCESS_KEY"].some((key) => process.env[key]),
		noHostMounts: !["/Users", "/host", "/app/.env", "/var/run/docker.sock"].some((path) => existsSync(path)),
		noDirectPublic: await deniedConnection("1.1.1.1", 443),
		noDirectPrivate: await deniedConnection("100.64.0.1", 5432),
		noDirectHost: await deniedConnection("192.168.5.2", 5432),
		gatewayRejectsPrivate: await gatewayDenies("100.64.0.1:443"),
		gatewayRejectsLoopback: await gatewayDenies("127.0.0.1:443"),
		gatewayRejectsUnapproved: await gatewayDenies("www.reddit.com:443"),
		gatewayRejectsPort: await gatewayDenies("x.com:5432"),
	};
	process.stdout.write(`${JSON.stringify({ isolation: checks, passed: Object.values(checks).every(Boolean) })}\n`);
	if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}

export function failureCategory(text: string): string {
	if (/no such option|usage:|invalid.*format/i.test(text)) return "invalid_extractor_options";
	if (/permission denied|operation not permitted|EACCES|EPERM/i.test(text)) return "sandbox_permission_denied";
	if (/timed? ?out|timeout|SIGKILL/i.test(text)) return "timeout";
	if (/sign.?in|log.?in|cookies|authentication|age.?restrict/i.test(text)) return "login_or_restriction";
	if (/429|rate.?limit/i.test(text)) return "rate_limited";
	if (/403|forbidden/i.test(text)) return "access_denied";
	if (/404|not found|unavailable|does not exist|deleted/i.test(text)) return "unavailable";
	if (/no video|no formats|does not contain a video/i.test(text)) return "no_video_formats";
	if (/larger than max-filesize|file is larger/i.test(text)) return "size_limit";
	if (/does not pass filter|does not pass the filter|rejected by filter/i.test(text)) return "duration_limit";
	return "extractor_error";
}

async function probe(url: string): Promise<void> {
	// This entry point runs only in the isolated harness, never as a bot message handler.
	const allowed = /^https:\/\/(?:x\.com\/[a-z0-9_]{1,15}\/status\/[1-9]\d{0,24}|www\.tiktok\.com\/@[a-z0-9_.]{1,32}\/video\/[1-9]\d{0,24}|www\.instagram\.com\/(?:p|reel)\/[a-z0-9_-]{1,64}\/)$/i;
	if (!allowed.test(url)) throw new Error("invalid_probe_input");
	const relay = createServer((client) => {
		const upstream = connect("/ipc/proxy.sock");
		client.on("error", () => { upstream.destroy(); });
		upstream.on("error", () => { client.destroy(); });
		client.on("close", () => { upstream.destroy(); });
		upstream.on("close", () => { client.destroy(); });
		client.pipe(upstream);
		upstream.pipe(client);
	});
	await new Promise<void>((resolve, reject) => {
		relay.once("error", reject);
		relay.listen(3128, "127.0.0.1", resolve);
	});
	try {
		const args = [
			"--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-cookies", "--no-update",
			"--proxy", "http://127.0.0.1:3128", "--socket-timeout", "8", "--retries", "0", "--extractor-retries", "0", "--fragment-retries", "0",
			"--use-extractors", "twitter,tiktok,instagram", "--no-playlist", "--playlist-end", "1",
			"--max-filesize", "32M", "--match-filter", "duration <=? 900", "--no-progress", "--no-simulate", "--dump-single-json", "--no-quiet",
			"--format", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][vcodec!=none][acodec!=none][filesize<=33554432]/worst[ext=mp4][vcodec!=none][acodec!=none]/worst[ext=mp4]",
			"--merge-output-format", "mp4",
			"--output", "/tmp/sample.%(ext)s", "--", url,
		];
		const extracted = await execute("/opt/extractor/bin/yt-dlp", args, { timeout: 55_000, killSignal: "SIGKILL", maxBuffer: 2 * 1_024 * 1_024 });
		const lines = extracted.stdout.split("\n");
		const jsonLine = lines.findLast((line) => line.startsWith("{"));
		if (!jsonLine) throw new Error("missing_extractor_result");
		const result = JSON.parse(jsonLine) as Record<string, unknown>;
		const files = [];
		for (const name of readdirSync("/tmp").filter((entry) => /^sample\.(mp4|mkv|webm)$/.test(entry))) {
			const filename = `/tmp/${name}`;
			const inspected = await execute("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration,size", "-of", "json", filename], { timeout: 5_000, maxBuffer: 65_536 });
			const media = JSON.parse(inspected.stdout);
			const duration = Number(media.format?.duration);
			const durationAccepted = Number.isFinite(duration) && duration > 0 && duration <= 900;
			const sizeAccepted = statSync(filename).size <= 32 * 1_024 * 1_024;
			let decodePassed = false;
			if (durationAccepted && sizeAccepted) {
				try {
					await execute("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-i", filename, "-t", "2", "-f", "null", "-"], { timeout: 8_000, maxBuffer: 65_536 });
					decodePassed = true;
				}
				catch { decodePassed = false; }
			}
			files.push({ bytes: statSync(filename).size, probe: media, durationAccepted, sizeAccepted, firstTwoSecondsDecode: decodePassed });
		}
		const skipCategory = failureCategory(`${extracted.stderr}\n${lines.filter((line) => line !== jsonLine).join("\n")}`);
		process.stdout.write(`${JSON.stringify({
			outcome: files.length ? "media_downloaded" : ["duration_limit", "size_limit"].includes(skipCategory) ? skipCategory : "no_media_downloaded",
			extractor: result.extractor_key, mediaId: result.id, displayId: result.display_id,
			durationSeconds: result.duration, reportedBytes: result.filesize, approximateBytes: result.filesize_approx,
			hasDescription: typeof result.description === "string" && result.description.length > 0,
			formatCount: Array.isArray(result.formats) ? result.formats.length : 0,
			files,
		})}\n`);
	}
	catch (error) {
		const failure = error as { stderr?: string; code?: unknown; signal?: string; killed?: boolean };
		const outcome = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output_limit" : failure.killed ? "timeout" : failureCategory(failure.stderr ?? "");
		process.stdout.write(`${JSON.stringify({ outcome, exitCode: typeof failure.code === "number" ? failure.code : undefined })}\n`);
	}
	finally {
		relay.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (process.argv[2] === "--isolation-check") {
		await isolationCheck();
	}
	else {
		await probe(process.argv[2] ?? "").catch(() => {
			process.stdout.write(`${JSON.stringify({ outcome: "invalid_probe_input" })}\n`);
			process.exitCode = 1;
		});
	}
}
