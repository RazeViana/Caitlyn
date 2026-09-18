/**
 * @file discordGatewayHealth.ts
 * @description Reports bounded gateway outages and recovery without competing with Discord.js reconnection.
 * Groups known transient failures, escalates persistent/fatal outages, and clears listeners on shutdown.
 *
 * @module discordGatewayHealth
 */

import { Events, type Client } from "discord.js";
import logger from "./logger.js";
import { withLogGuild } from "./logContext.js";

interface Outage {
	started: number;
	lastWarning: number;
	attempts: number;
	failures: number;
	escalated: boolean;
	timer?: ReturnType<typeof setTimeout>;
}

function transientReason(error: Error): string | undefined {
	if (error.message === "Opening handshake has timed out") return "Discord took too long to answer";
	const code = (error as NodeJS.ErrnoException).code;
	const reasons: Record<string, string> = {
		ECONNRESET: "the connection closed unexpectedly",
		ECONNREFUSED: "the connection was refused",
		ETIMEDOUT: "the connection took too long",
		ENETUNREACH: "the network could not be reached",
		EHOSTUNREACH: "Discord could not be reached",
		EAI_AGAIN: "Discord's network address could not be found right now",
		ENOTFOUND: "Discord's network address could not be found",
	};
	if (code && Object.hasOwn(reasons, code)) return `${reasons[code]} (${code})`;
}

export function watchDiscordGateway(client: Client, options: {
	now?: () => number;
	outageMs?: number;
	repeatMs?: number;
	log?: Pick<typeof logger, "warn" | "error" | "success" | "debug">;
} = {}): () => void {
	const now = options.now ?? Date.now;
	const log = options.log ?? logger;
	const outages = new Map<number, Outage>();
	let stopped = false;
	const scoped = (action: () => void): void => withLogGuild(undefined, action);
	function outage(shardId: number): Outage {
		let state = outages.get(shardId);
		if (state) return state;
		state = { started: now(), lastWarning: -Infinity, attempts: 0, failures: 0, escalated: false };
		const current = state;
		state.timer = setTimeout(() => scoped(() => {
			if (stopped || outages.get(shardId) !== current || current.escalated) return;
			current.escalated = true;
			log.error("Still unable to connect to Discord; automatic reconnect attempts are continuing. Check the network if this continues", `connection: ${shardId}`, `time disconnected: ${Math.max(0, now() - current.started)} ms`, `attempts: ${current.attempts}`);
		}), options.outageMs ?? 300_000);
		state.timer.unref();
		outages.set(shardId, state);
		return state;
	}
	function warn(state: Outage, shardId: number, reason: string): void {
		if (now() - state.lastWarning < (options.repeatMs ?? 60_000)) return;
		state.lastWarning = now();
		log.warn("Discord connection interrupted; trying to reconnect", `connection: ${shardId}`, `reason: ${reason}`, `failures: ${state.failures}`, `attempts: ${state.attempts}`);
	}
	const error = (failure: Error, shardId: number): void => scoped(() => {
		if (stopped) return;
		const state = outage(shardId);
		state.failures++;
		const reason = transientReason(failure);
		if (reason) warn(state, shardId, reason);
		else log.error("Unexpected Discord connection error:", `connection: ${shardId}`, failure);
	});
	const reconnecting = (shardId: number): void => scoped(() => {
		if (stopped) return;
		const state = outage(shardId);
		state.attempts++;
		warn(state, shardId, "Discord is reconnecting");
		log.debug("Trying to reconnect to Discord", `connection: ${shardId}`, `attempt: ${state.attempts}`);
	});
	const recovered = (shardId: number): void => scoped(() => {
		const state = outages.get(shardId);
		if (stopped || !state) return;
		clearTimeout(state.timer);
		outages.delete(shardId);
		log.success("Connected to Discord again", `connection: ${shardId}`, `time disconnected: ${Math.max(0, now() - state.started)} ms`, `attempts: ${state.attempts}`, `failures: ${state.failures}`);
	});
	const disconnected = (event: { code: number }, shardId: number): void => scoped(() => {
		if (stopped) return;
		const state = outage(shardId);
		clearTimeout(state.timer);
		if (state.escalated && state.lastWarning === Infinity) return;
		state.escalated = true;
		state.lastWarning = Infinity;
		log.error("Discord disconnected the bot and it cannot reconnect automatically; please check the bot's Discord settings", `connection: ${shardId}`, `Discord code: ${event.code}`);
	});
	client.on(Events.ShardError, error);
	client.on(Events.ShardReconnecting, reconnecting);
	client.on(Events.ShardReady, recovered);
	client.on(Events.ShardResume, recovered);
	client.on(Events.ShardDisconnect, disconnected);
	return () => {
		stopped = true;
		for (const state of outages.values()) clearTimeout(state.timer);
		outages.clear();
		client.off(Events.ShardError, error);
		client.off(Events.ShardReconnecting, reconnecting);
		client.off(Events.ShardReady, recovered);
		client.off(Events.ShardResume, recovered);
		client.off(Events.ShardDisconnect, disconnected);
	};
}
