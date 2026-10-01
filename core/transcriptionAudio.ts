/**
 * @file transcriptionAudio.ts
 * @description Splits per-speaker PCM at pauses, time limits and local midnight, and calls the local worker.
 * @module transcriptionAudio
 */

import { transcriptDay } from "./transcriptionStore.js";
import type { TranscriptionConfig } from "./transcriptionConfig.js";

export const SAMPLE_RATE = 16000;
export const MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * 20;
export interface AudioChunk { pcm: Buffer; at: number; end: number }

export function waveAudio(pcm: Buffer): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(SAMPLE_RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

export class SpeakerBuffer {
	private frames: Buffer[] = [];
	private bytes = 0;
	private at = 0;
	private end = 0;
	constructor(private readonly timezone: string, private readonly emit: (chunk: AudioChunk) => void) {}

	push(pcm: Buffer, now: number): void {
		if (this.bytes && (this.bytes + pcm.length > MAX_AUDIO_BYTES || now - this.end > 1000 || now - this.at >= 20_000 || transcriptDay(this.at, this.timezone) !== transcriptDay(now, this.timezone))) this.flush();
		if (!this.bytes) this.at = now;
		this.end = now;
		this.frames.push(Buffer.from(pcm));
		this.bytes += pcm.length;
		if (this.bytes >= MAX_AUDIO_BYTES) this.flush();
	}

	idle(now: number): void { if (this.bytes && now - this.end >= 1000) this.flush(); }
	flush(): void {
		if (this.bytes) this.emit({ pcm: Buffer.concat(this.frames), at: this.at, end: this.end });
		this.frames = [];
		this.bytes = 0;
	}
}

export function localTranscriber(config: TranscriptionConfig, fetcher: typeof fetch = fetch) {
	return async (pcm: Buffer, signal: AbortSignal): Promise<string> => {
		const url = new URL(config.endpoint);
		url.searchParams.set("language", config.language);
		const response = await fetcher(url, {
			method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(waveAudio(pcm)),
			signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), redirect: "error",
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Local transcription worker returned HTTP ${response.status}`);
		}
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Empty transcription response");
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.length;
				if (bytes > 64_000) throw new Error("Transcription response exceeds limit");
				chunks.push(value);
			}
		}
		finally { await reader.cancel(); }
		const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (typeof result.text !== "string" || result.text.length > 16_000) throw new Error("Invalid transcription response");
		return result.text.trim();
	};
}
