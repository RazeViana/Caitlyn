/**
 * @file provisionSecrets.mjs
 * @description Creates separate owner-only server secret mounts from the existing server environment and local X session.
 * Secrets travel only over SSH stdin, never command arguments, Docker settings, build contexts or logs.
 *
 * @module provisionDeploymentSecrets
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { loadXSessionFromEnv } from "../fxEmbed/envSession.ts";
import { encryptXSession } from "../fxEmbed/credentials.ts";

try {
	const [alias, host, keyAlias, sourceFile, root, backupDirectory] = process.argv.slice(2);
	if (process.argv.length !== 8 || !/^[a-zA-Z0-9_-]+$/.test(alias ?? "")
		|| ![host, keyAlias].every((value) => /^[a-zA-Z0-9.:-]+$/.test(value ?? ""))
		|| ![sourceFile, root].every((value) => /^\/mnt\/[a-zA-Z0-9_./-]+$/.test(value ?? "") && !value.includes(".."))
		|| !isAbsolute(backupDirectory ?? "")) throw new Error("explicit_private_paths_required");
	const ssh = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=" + keyAlias, "-o", "HostName=" + host, alias];
	const previous = execFileSync("ssh", [...ssh, "sudo -n cat " + sourceFile], { maxBuffer: 65_536, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
	const environment = parse(previous);
	await writeFile(backupDirectory + "/server-before.env", previous, { flag: "wx", mode: 0o600 });
	previous.fill(0);
	const localFile = fileURLToPath(new URL("../../.env", import.meta.url));
	const local = parse(await readFile(localFile));
	if (!environment.TOKEN || environment.TOKEN !== local.TOKEN || environment.CLIENT_ID !== local.CLIENT_ID || environment.GUILD_ID !== local.GUILD_ID) throw new Error("server_identity_differs_from_active_local_identity");
	if (environment.PGDATABASE !== "caitlyn" || environment.PGPORT !== "5433") throw new Error("original_database_target_changed");
	for (const name of Object.keys(environment)) if (name.startsWith("FXEMBED_X_")) delete environment[name];
	Object.assign(environment, { LLM_ENABLED: "false", SOCIAL_MEDIA_ENABLED: "true", SOCIAL_WORKER_SOCKET: "/run/caitlyn-ipc/worker.sock",
		BIRTHDAY_TIMEZONE: local.BIRTHDAY_TIMEZONE || "Europe/Amsterdam", LOG_LEVEL: "INFO" });
	const apiKey = randomBytes(32).toString("hex");
	const config = encryptXSession(await loadXSessionFromEnv(localFile), apiKey);
	const files = { "fx/runtime.json": JSON.stringify(config), "key/fxembed.key": apiKey,
		"bot/bot.env": Object.entries(environment).map(([name, value]) => name + "=" + JSON.stringify(value)).join("\n") + "\n" };
	const receiver = `import json,os,stat,sys
p=json.load(sys.stdin)
root=p["root"]
source=p["source"]
s=os.lstat(source)
if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1: raise ValueError("unsafe_original_environment")
os.mkdir(root,0o700)
os.chmod(root,0o700)
for name in ("fx","key","bot","ipc"):
    path=root+"/"+name
    os.mkdir(path,0o700)
    os.chmod(path,0o700)
    os.chown(path,1000,1000)
for name,value in p["files"].items():
    if name not in ("fx/runtime.json","key/fxembed.key","bot/bot.env"): raise ValueError("unexpected_secret_path")
    fd=os.open(root+"/"+name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    os.fchmod(fd,0o600)
    os.fchown(fd,1000,1000)
    with os.fdopen(fd,"w") as f: f.write(value)
os.chmod(source,0o600,follow_symlinks=False)
print("Protected bot, API-key and X configuration files created; original environment permissions tightened")`;
	const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
	const output = execFileSync("ssh", [...ssh, "sudo -n python3 -c " + quote(receiver)], {
		input: JSON.stringify({ root, source: sourceFile, files }), maxBuffer: 4_096, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"],
	});
	console.log(output.toString().trim());
}
catch {
	console.error("Secret provisioning stopped; inspect protected paths and identity/configuration checks before retrying. No secret values were logged");
	process.exitCode = 1;
}
