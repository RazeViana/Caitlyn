/** Tests delayed Docker creation, scoped recovery, and media startup without Docker or Discord. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { recoverDockerResources, jobLabels, OWNER_LABEL, JOB_LABEL, WORKER_LABEL } from "../scripts/socialWorker/dockerResources.ts";
import { createDockerSocialRunner, workerFailureReason } from "../scripts/socialWorker/runner.ts";
import { checkedDelivery } from "../scripts/mediaSandbox/worker.ts";
import { SOCIAL_FILE_LIMIT, SOCIAL_TOTAL_LIMIT } from "../core/socialWorkerClient.ts";

const owner = "a".repeat(64);
const job = "12345678-1234-1234-1234-123456789abc";
const image = "sha256:" + "b".repeat(64);
const input = { version: 1, url: "https://x.com/alice/status/123", attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT };
const payload = (media = []) => ({ code: 200, status: { type: "status", provider: "twitter", id: "123",
	author: { name: "Alice", screen_name: "alice" }, text: "Hello", media: { all: media } } });
const photo = { type: "photo", url: "https://pbs.twimg.com/media/test.png?name=orig", width: 600, height: 400 };

function dockerFixture() {
	const containers = new Map();
	const volumes = new Map();
	const calls = [];
	let counter = 0;
	const labelsOf = (args) => Object.fromEntries(args.filter((arg) => arg.startsWith("--label=")).map((arg) => {
		const [key, ...value] = arg.slice(8).split("="); return [key, value.join("=")];
	}));
	function add(labels = labelsOf(jobLabels(owner, job)), kind = "gateway", volumeLabels = labels) {
		const prefix = `caitlyn-social-${labels[JOB_LABEL]}`;
		const volume = prefix + "-ipc";
		const container = { Id: (++counter).toString(16).padStart(64, "0"), Name: "/" + prefix + "-" + kind,
			Config: { User: "1000:1000", Labels: labels },
			HostConfig: { ReadonlyRootfs: true, Privileged: false, NetworkMode: kind === "gateway" ? "bridge" : "none" },
			Mounts: [{ Type: "volume", Name: volume, Destination: "/ipc" }] };
		containers.set(container.Id, container);
		if (!volumes.has(volume)) volumes.set(volume, { Name: volume, Driver: "local", Scope: "local", Options: null, Labels: volumeLabels });
		return container;
	}
	function filtered(values, args, container) {
		return values.filter((value) => args.filter((arg) => arg.startsWith("--filter=")).every((arg) => {
			const filter = arg.slice(9);
			if (filter.startsWith("label=")) {
				const [key, expected] = filter.slice(6).split("=");
				return (container ? value.Config.Labels : value.Labels)?.[key] === expected;
			}
			if (filter.startsWith("id=")) return value.Id === filter.slice(3);
			if (filter.startsWith("name=")) return value.Name === filter.slice(5);
			if (filter.startsWith("volume=")) return value.Mounts.some((mount) => mount.Name === filter.slice(7));
			throw new Error("Unexpected filter: " + filter);
		}));
	}
	const docker = async (args, _timeout, _signal, stdin) => {
		calls.push(args);
		if (args[0] === "context") return JSON.stringify("unix:///var/run/docker.sock");
		if (args[0] === "image") return image;
		if (args[0] === "ps") return filtered([...containers.values()], args, true).map((c) => c.Id).join("\n");
		if (args[0] === "inspect") return JSON.stringify(args.slice(1).map((id) => containers.get(id)));
		if (args[0] === "rm") {
			containers.delete(args.at(-1));
			return args.at(-1);
		}
		if (args[0] === "volume") {
			if (args[1] === "ls") return filtered([...volumes.values()], args, false).map((v) => v.Name).join("\n");
			if (args[1] === "inspect") return JSON.stringify([volumes.get(args.at(-1))]);
			if (args[1] === "rm") {
				volumes.delete(args.at(-1));
				return args.at(-1);
			}
			if (args[1] === "create") {
				volumes.set(args.at(-1), { Name: args.at(-1), Driver: "local", Scope: "local", Options: null, Labels: labelsOf(args) });
				return args.at(-1);
			}
		}
		if (args[0] === "exec") return "";
		if (args[0] === "run") {
			assert.ok(args.includes("--rm") && args.includes("--read-only") && args.includes("--init"));
			if (args.includes("-d")) return add(labelsOf(args)).Id;
			assert.ok(args.includes("--checked-delivery"));
			assert.ok(args.includes("--network=none"));
			assert.equal(JSON.parse(stdin).code, 200);
			return JSON.stringify({ outcome: "ready", files: [] });
		}
		throw new Error("Unexpected command: " + args.join(" "));
	};
	return { docker, add, calls, containers, volumes };
}

test("recovery removes only this instance's temporary resources, including a volume Docker recreated without labels", async () => {
	const fixture = dockerFixture();
	fixture.add(undefined, "gateway", null);
	const foreign = fixture.add({ [WORKER_LABEL]: "true", [OWNER_LABEL]: "c".repeat(64), [JOB_LABEL]: "22345678-1234-1234-1234-123456789abc" });
	assert.deepEqual(await recoverDockerResources(fixture.docker, owner), { containers: 1, volumes: 1 });
	assert.deepEqual([...fixture.containers.keys()], [foreign.Id]);
	assert.equal(fixture.volumes.size, 1);
	assert.ok(!fixture.calls.some((args) => args.includes("prune")));
});

test("ambiguous workers and volumes attached to foreign containers remain untouched", async () => {
	for (const tamper of [
		(c) => { c.Name = "/unrelated-service"; },
		(c) => { c.Config.Labels[JOB_LABEL] = "not-a-job"; },
		(c) => { c.HostConfig.Privileged = true; },
		(c) => { c.Mounts[0].Type = "bind"; },
		(c) => { c.Mounts[0].Name = "user-database"; },
		(c) => { c.HostConfig.NetworkMode = "host"; },
		(c, f) => { const other = f.add({ [WORKER_LABEL]: "true", [OWNER_LABEL]: "c".repeat(64), [JOB_LABEL]: "22345678-1234-1234-1234-123456789abc" }); other.Mounts = c.Mounts; },
	]) {
		const fixture = dockerFixture();
		tamper(fixture.add(), fixture);
		await assert.rejects(recoverDockerResources(fixture.docker, owner), /worker_cleanup_required/);
		assert.ok(!fixture.calls.some((args) => args[0] === "rm" || args[1] === "rm"));
	}
});

test("cleanup handles a worker that auto-removes between inspection and removal", async () => {
	const fixture = dockerFixture();
	fixture.add();
	await recoverDockerResources(async (...args) => {
		if (args[0][0] === "rm") {
			fixture.containers.clear();
			throw new Error("already removed");
		}
		return fixture.docker(...args);
	}, owner);
	assert.equal(fixture.volumes.size, 0);
});

async function runner(context, fixture, metadata = payload(), docker = fixture.docker) {
	if (!fixture.directory) {
		fixture.directory = await mkdtemp("/tmp/caitlyn-runner-");
		context.after(() => rm(fixture.directory, { recursive: true, force: true }));
	}
	return createDockerSocialRunner("default", image, "fxembed", undefined, undefined,
		{ socketPath: fixture.directory + "/worker.sock", docker, fetchMetadata: async () => ({ outcome: "received", payload: metadata }) });
}

test("text-only X posts bypass media containers while quoted media still takes the verified path", async (context) => {
	const fixture = dockerFixture();
	const textRun = await runner(context, fixture);
	const result = await textRun(input, new AbortController().signal);
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.text, "Hello");
	assert.deepEqual(result.files, []);
	assert.ok(!fixture.calls.some((args) => args[0] === "run" || args[1] === "create"));
	const quoted = payload();
	quoted.status.quote = { ...payload([photo]).status, id: "456" };
	const mediaRun = await runner(context, fixture, quoted);
	assert.equal((await mediaRun(input, new AbortController().signal)).outcome, "ready");
	assert.equal(fixture.calls.filter((args) => args[0] === "run").length, 2);
	assert.ok(!fixture.calls.some((args) => args.some((arg) => arg.endsWith("-verifier"))));
	assert.equal(fixture.containers.size, 0);
	assert.equal(fixture.volumes.size, 0);
});

test("a late container from a timed-out job is recovered before the next media job", async (context) => {
	const fixture = dockerFixture();
	let late;
	let first = true;
	const run = await runner(context, fixture, payload([photo]), async (...parameters) => {
		const args = parameters[0];
		if (first && args[0] === "run" && args.includes("-d")) {
			first = false;
			late = () => fixture.docker(...parameters);
			throw new Error("worker_docker_timeout");
		}
		return fixture.docker(...parameters);
	});
	assert.equal((await run(input, new AbortController().signal)).outcome, "worker_unavailable");
	assert.equal(fixture.volumes.size, 0);
	await late();
	for (const volume of fixture.volumes.values()) volume.Labels = null;
	assert.equal(fixture.containers.size, 1);
	assert.equal((await run(input, new AbortController().signal)).outcome, "ready");
	assert.equal(fixture.containers.size, 0);
	assert.equal(fixture.volumes.size, 0);
	assert.equal(run.healthy(), true);
});

test("unlabelled legacy workers require review and raw Docker errors never enter diagnostics", async (context) => {
	const fixture = dockerFixture();
	const legacy = fixture.add();
	delete legacy.Config.Labels[OWNER_LABEL];
	await assert.rejects(runner(context, fixture), /worker_cleanup_required/);
	assert.equal(fixture.containers.size, 1);
	assert.equal(workerFailureReason(new Error("token=private https://example.test/private")), "worker_operation_failed");
	assert.equal(workerFailureReason(new Error("worker_docker_timeout")), "worker_docker_timeout");
});

test("restarting a broker recovers its labelled resources using the same private directory", async (context) => {
	const fixture = dockerFixture();
	const run = await runner(context, fixture, payload([photo]));
	await run(input, new AbortController().signal);
	const create = fixture.calls.find((args) => args[0] === "run" && args.includes("-d"));
	await fixture.docker(create);
	assert.equal(fixture.containers.size, 1);
	await runner(context, fixture, payload([photo]));
	assert.equal(fixture.containers.size, 0);
	assert.equal(fixture.volumes.size, 0);
});

test("failed cleanup affects health and is retried successfully on the next job", async (context) => {
	const fixture = dockerFixture();
	let removalFails = true;
	const run = await runner(context, fixture, payload([photo]), async (...parameters) => {
		if (parameters[0][0] === "rm" && removalFails) throw new Error("worker_docker_timeout");
		return fixture.docker(...parameters);
	});
	await run(input, new AbortController().signal);
	assert.equal(run.healthy(), false);
	assert.equal(fixture.containers.size, 1);
	removalFails = false;
	assert.equal((await run(input, new AbortController().signal)).outcome, "ready");
	assert.equal(run.healthy(), true);
	assert.equal(fixture.containers.size, 0);
	assert.equal(fixture.volumes.size, 0);
});

test("idle recovery clears failed cleanup without requiring another media delivery", async (context) => {
	const fixture = dockerFixture();
	let removalFails = true;
	const run = await runner(context, fixture, payload([photo]), async (...parameters) => {
		if (parameters[0][0] === "rm" && removalFails) throw new Error("worker_docker_timeout");
		return fixture.docker(...parameters);
	});
	await run(input, new AbortController().signal);
	await assert.rejects(run.recover(), /worker_docker_timeout/);
	assert.equal(run.healthy(), false);
	const deliveries = fixture.calls.filter((args) => args[0] === "run").length;
	removalFails = false;
	await run.recover();
	assert.equal(run.healthy(), true);
	assert.equal(fixture.containers.size, 0);
	assert.equal(fixture.volumes.size, 0);
	assert.equal(fixture.calls.filter((args) => args[0] === "run").length, deliveries);
});

test("delivery cannot read metadata or download media until its own isolation checks pass", async () => {
	let deliveries = 0;
	const deliver = async () => { deliveries++; };
	const valid = Object.fromEntries(["unprivileged", "noCredentials", "noHostMounts", "noDirectPublic", "noDirectPrivate", "noDirectHost",
		"gatewayRejectsPrivate", "gatewayRejectsLoopback", "gatewayRejectsUnapproved", "gatewayRejectsPort", "gatewayRejectsHostedMetadata"].map((key) => [key, true]));
	assert.equal(await checkedDelivery(deliver, async (selfHosted) => {
		assert.equal(selfHosted, true);
		return valid;
	}), true);
	for (const checks of [{ ...valid, gatewayRejectsHostedMetadata: false }, { ...valid, noDirectPublic: false }, { gatewayRejectsHostedMetadata: true }, {}]) {
		assert.equal(await checkedDelivery(deliver, async () => checks), false);
	}
	assert.equal(deliveries, 1);
});
