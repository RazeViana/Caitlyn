/**
 * @file transcriptionVoice.ts
 * @description Receives DAVE-compatible Discord audio as separate per-user 16 kHz mono PCM streams.
 * @module transcriptionVoice
 */

import { EndBehaviorType, entersState, joinVoiceChannel, VoiceConnectionStatus, type AudioReceiveStream } from "@discordjs/voice";
import OpusScript from "opusscript";
import type { VoiceChannel } from "discord.js";

export interface VoiceCapture {
	ready: Promise<void>;
	sync: (userIds: string[]) => void;
	close: () => void;
}

export function connectTranscriptionVoice(
	channel: VoiceChannel,
	packet: (userId: string, pcm: Buffer, at: number) => void,
	failure: () => void,
): VoiceCapture {
	const connection = joinVoiceChannel({ guildId: channel.guild.id, channelId: channel.id,
		adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
	const users = new Map<string, { stream: AudioReceiveStream; decoder: OpusScript }>();
	let closed = false;
	const remove = (userId: string): void => {
		const user = users.get(userId);
		if (!user) return;
		users.delete(userId);
		user.stream.destroy();
		user.decoder.delete();
	};
	connection.on("error", () => { if (!closed) failure(); });
	connection.on(VoiceConnectionStatus.Disconnected, () => { if (!closed) failure(); });
	return {
		ready: entersState(connection, VoiceConnectionStatus.Ready, 20_000).then(() => undefined),
		sync: (userIds) => {
			if (closed) return;
			for (const userId of users.keys()) if (!userIds.includes(userId)) remove(userId);
			for (const userId of userIds) {
				if (users.has(userId)) continue;
				const decoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);
				const stream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
				users.set(userId, { stream, decoder });
				stream.on("error", () => { if (!closed) failure(); });
				stream.on("data", (opus: Buffer) => {
					if (closed || !users.has(userId)) return;
					try { packet(userId, Buffer.from(decoder.decode(opus)), Date.now()); }
					catch { failure(); }
				});
			}
		},
		close: () => {
			if (closed) return;
			closed = true;
			for (const userId of users.keys()) remove(userId);
			if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
		},
	};
}
