/**
 * @file gateway.ts
 * @description Restricts disposable media workers to bounded HTTPS tunnels to public provider hosts.
 * Listens only on a shared Unix socket; rejects private DNS answers and pins the connection IP.
 *
 * @module gateway
 */

import { lookup } from "node:dns/promises";
import { chmodSync } from "node:fs";
import { createServer } from "node:http";
import { BlockList, connect, isIP } from "node:net";
import { pathToFileURL } from "node:url";

const denied = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
	["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
	["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
	["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) denied.addSubnet(address, prefix, "ipv4");

// Deliberately IPv4-only for this diagnostic; reject rather than translate IPv6/mapped addresses.
export function isPublicAddress(address: string): boolean {
	return isIP(address) === 4 && !denied.check(address, "ipv4");
}

const domains = [
	"x.com", "twitter.com", "twimg.com",
	"tiktok.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktokv.us", "muscdn.com", "byteoversea.com", "ibytedtos.com",
	"instagram.com", "cdninstagram.com", "fbcdn.net",
];

export function allowedTunnel(authority: string): string | null {
	const match = authority.match(/^([a-z0-9]+(?:[.-][a-z0-9]+)*):443$/i);
	if (!match) return null;
	const host = match[1].toLowerCase();
	if (!domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
	return host;
}

export async function resolvePublicHost(host: string, resolve = lookup): Promise<string> {
	const addresses = await resolve(host, { all: true, family: 4 });
	if (!addresses.length || addresses.some((answer) => !isPublicAddress(answer.address))) throw new Error("blocked_address");
	return addresses[0].address;
}

export function startGateway(socketPath = "/ipc/proxy.sock") {
	let totalBytes = 0;
	let active = 0;
	const log = (event: string, host?: string): void => {
		// The host is from the strict allowlist parser; never log request paths, headers, or errors.
		process.stdout.write(`${JSON.stringify({ event, host })}\n`);
	};
	const server = createServer((_request, response) => {
		response.writeHead(405, { Connection: "close" });
		response.end();
	});
	server.maxHeadersCount = 32;
	server.headersTimeout = 5_000;
	server.requestTimeout = 5_000;
	server.on("clientError", (_error, socket) => { socket.destroy(); });
	server.on("connect", (request, client, head) => {
		const host = allowedTunnel(request.url ?? "");
		if (!host || active >= 8 || totalBytes >= 128 * 1_024 * 1_024) {
			log("blocked_tunnel");
			client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		active++;
		const deadline = setTimeout(() => { client.destroy(); }, 20_000);
		client.on("error", () => { client.destroy(); });
		client.once("close", () => {
			active--;
			clearTimeout(deadline);
		});
		void resolvePublicHost(host).then((address) => {
			if (client.destroyed) return;
			// An IP literal prevents a second DNS lookup between validation and connect.
			const upstream = connect({ host: address, port: 443, family: 4 });
			client.once("close", () => { upstream.destroy(); });
			upstream.on("error", () => {
				log("upstream_error", host);
				client.destroy();
			});
			upstream.once("close", () => { client.destroy(); });
			const count = (chunk: Buffer): void => {
				totalBytes += chunk.length;
				if (totalBytes > 128 * 1_024 * 1_024) {
					log("byte_limit");
					client.destroy();
					upstream.destroy();
				}
			};
			upstream.once("connect", () => {
				log("connected", host);
				client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (head.length) {
					count(head);
					upstream.write(head);
				}
				client.on("data", count);
				upstream.on("data", count);
				client.pipe(upstream);
				upstream.pipe(client);
			});
		}).catch(() => {
			log("blocked_dns", host);
			client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		});
	});
	server.listen(socketPath, () => {
		chmodSync(socketPath, 0o666);
		log("ready");
	});
	return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startGateway();
