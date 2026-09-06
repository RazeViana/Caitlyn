/**
 * @file databaseMigrations.test.js
 * @description Verifies migrations and transactional activity behavior in a disposable local PostgreSQL database.
 * Requires explicit opt-in, uses synthetic data, and cleans up only its own database.
 *
 * @module databaseMigrations.test
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { test } from "node:test";
import pg from "pg";

const migrationsDirectory = new URL("../migrations/", import.meta.url);
const birthdayMigration = "009_create_birthdays_table.sql";

// Opt in explicitly: ordinary tests must never contact a database.
// Application imports may load .env, but only the explicit configuration below
// selects test connections; never use the application's PGHOST/PGDATABASE.
test("database migrations bootstrap a fresh local database safely", {
	skip: process.env.CAITLYN_TEST_POSTGRES !== "1",
	timeout: 120_000,
}, async (context) => {
	const connection = {
		host: "127.0.0.1",
		port: Number(process.env.CAITLYN_TEST_PGPORT ?? "5432"),
		user: process.env.CAITLYN_TEST_PGUSER ?? userInfo().username,
		password: process.env.CAITLYN_TEST_PGPASSWORD ?? "",
		ssl: false,
		connectionTimeoutMillis: 5_000,
		statement_timeout: 15_000,
		query_timeout: 20_000,
	};
	const database = `caitlyn_migrations_${randomUUID().replaceAll("-", "")}`;
	const administrator = new pg.Client({ ...connection, database: "postgres" });
	const client = new pg.Client({ ...connection, database });
	const applicationPool = new pg.Pool({ ...connection, database });
	let created = false;

	try {
		await administrator.connect();
		await administrator.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
		created = true;
		await client.connect();
		const filenames = (await readdir(migrationsDirectory))
			.filter((name) => /^\d{3}_.*\.sql$/.test(name))
			.sort();

		await context.test("all migrations apply in order and create the application tables", async () => {
			assert.ok(filenames.includes(birthdayMigration));
			for (const filename of filenames) {
				const sql = await readFile(new URL(filename, migrationsDirectory), "utf8");
				await client.query(sql);
			}
			const { rows } = await client.query(
				"SELECT tablename FROM pg_tables WHERE schemaname = 'discord' ORDER BY tablename",
			);
			assert.deepEqual(rows.map((row) => row.tablename), [
				"birthday_deliveries", "birthday_occurrences", "birthdays", "daily_activity", "guild_settings", "messages", "user_activity", "voice_sessions",
			]);
		});

		await context.test("private logging survives replay and reserves one main server even while disabled", async () => {
			const { createGuildSettingsStore } = await import("../core/guildSettings.ts");
			const settings = createGuildSettingsStore(applicationPool);
			await client.query("INSERT INTO discord.guild_settings (guild_id, log_channel_id) VALUES ('111', '222')");
			await assert.rejects(settings.save("111", "222", false), /application owner/);
			await settings.save("333", "444", true);
			await settings.setLevels("333", "444", ["DEBUG", "ERROR"], true);
			await client.query(await readFile(new URL("011_create_guild_settings.sql", migrationsDirectory), "utf8"));
			await client.query(await readFile(new URL("012_private_logging_levels.sql", migrationsDirectory), "utf8"));
			assert.deepEqual((await settings.getMain()).log_levels, ["DEBUG", "ERROR"]);
			assert.equal((await settings.getMain()).guild_id, "333");
			assert.equal((await settings.list()).length, 1);
			await assert.rejects(settings.setLevels("333", "999", ["INFO"], true), /configured logging channel/);
			await assert.rejects(settings.setLevels("333", "444", ["INVALID"], true), /Invalid log level/);
			await assert.rejects(settings.setLevels("333", "444", ["INFO"], false), /application owner/);
			await settings.save("333", null, true);
			assert.equal((await settings.getMain()).log_channel_id, null);
			await assert.rejects(settings.save("111", "222", true), /configured main server/);
			await assert.rejects(client.query("INSERT INTO discord.guild_settings (guild_id, log_scope) VALUES ('999', 'console')"), /guild_settings_main_logging_server/);
			await settings.save("333", "445", true);
			assert.deepEqual((await settings.getMain()).log_levels, ["DEBUG", "ERROR"]);
			await settings.setLevels("333", "445", [], true);
			assert.deepEqual((await settings.getMain()).log_levels, []);
			const results = await Promise.allSettled([
				settings.save("555", "666", true),
				settings.save("777", "888", true),
			]);
			assert.ok(results.every((result) => result.status === "rejected"));
		});

		await context.test("birthdays match the legacy column types, nullability, and primary key", async () => {
			const { rows } = await client.query(`
				SELECT column_name, data_type, is_nullable, column_default
				FROM information_schema.columns
				WHERE table_schema = 'discord' AND table_name = 'birthdays'
				ORDER BY ordinal_position
			`);
			assert.deepEqual(rows.map(({ column_name, data_type, is_nullable }) => ({
				column_name, data_type, is_nullable,
			})), [
				{ column_name: "id", data_type: "integer", is_nullable: "NO" },
				{ column_name: "discord_id", data_type: "bigint", is_nullable: "NO" },
				{ column_name: "name", data_type: "text", is_nullable: "NO" },
				{ column_name: "dob", data_type: "date", is_nullable: "NO" },
			]);
			assert.equal(rows[0].column_default, "nextval('discord.birthdays_id_seq'::regclass)");
			const constraints = await client.query(`
				SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
				WHERE conrelid = 'discord.birthdays'::regclass ORDER BY conname
			`);
			assert.deepEqual(constraints.rows, [{ definition: "PRIMARY KEY (id)" }]);
		});

		await context.test("reapplying the birthday migration preserves rows and sequence state", async () => {
			const { rows } = await client.query(`
				INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3)
				RETURNING id, discord_id, name, dob::text
			`, ["123456789012345678", "Migration fixture", "2000-02-29"]);
			const before = await client.query("SELECT last_value, is_called FROM discord.birthdays_id_seq");
			const sql = await readFile(new URL(birthdayMigration, migrationsDirectory), "utf8");
			await client.query(sql);
			await client.query(sql);
			const after = await client.query("SELECT id, discord_id, name, dob::text FROM discord.birthdays");
			assert.deepEqual(after.rows, rows);
			assert.equal(after.rows[0].discord_id, "123456789012345678");
			assert.equal(after.rows[0].dob, "2000-02-29");
			const sequence = await client.query("SELECT last_value, is_called FROM discord.birthdays_id_seq");
			assert.deepEqual(sequence.rows, before.rows);
		});

		await context.test("birthday inserts, updates, and deletes work after replay", async () => {
			const inserted = await client.query(`
				INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3) RETURNING id
			`, ["234567890123456789", "Second fixture", "1997-12-31"]);
			assert.equal(inserted.rows[0].id, 2);
			const updated = await client.query(`
				UPDATE discord.birthdays SET dob = $1, name = $2 WHERE discord_id = $3
				RETURNING dob::text, name
			`, ["1998-01-01", "Updated fixture", "234567890123456789"]);
			assert.deepEqual(updated.rows, [{ dob: "1998-01-01", name: "Updated fixture" }]);
			const deleted = await client.query(
				"DELETE FROM discord.birthdays WHERE discord_id = $1", ["234567890123456789"],
			);
			assert.equal(deleted.rowCount, 1);
		});

		await context.test("birthday uniqueness supports concurrent upserts and refuses legacy duplicates without deletion", async () => {
			const upsert = "INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3) ON CONFLICT (discord_id) DO UPDATE SET dob = EXCLUDED.dob";
			await Promise.all([1, 2, 3].map(() => applicationPool.query(upsert, ["345678901234567890", "Concurrent fixture", "2000-02-29"])));
			const count = await client.query("SELECT COUNT(*)::int AS count FROM discord.birthdays WHERE discord_id = $1", ["345678901234567890"]);
			assert.equal(count.rows[0].count, 1);
			await client.query("BEGIN");
			try {
				await client.query("DROP INDEX discord.birthdays_discord_id_key");
				await client.query("INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3)", ["345678901234567890", "Duplicate fixture", "2001-03-01"]);
				const sql = await readFile(new URL("010_unique_birthday_discord_id.sql", migrationsDirectory), "utf8");
				await assert.rejects(client.query(sql), /manual reconciliation/);
			}
			finally {
				await client.query("ROLLBACK");
			}
		});

		await context.test("voice transactions roll back every partial failure and concurrent retries count once", async () => {
			const { withTransaction } = await import("../core/transaction.ts");
			const { trackVoiceJoin, trackVoiceLeave } = await import("../core/activityTracker.ts");
			const joinedAt = Date.now();
			const transaction = (operation) => withTransaction(operation, applicationPool);
			await trackVoiceJoin("fixture-guild", "fixture-user", "Fixture", "room", "Room", { now: () => joinedAt, transaction });
			await trackVoiceJoin("fixture-guild", "fixture-user", "Fixture", "room", "Room", { now: () => joinedAt, transaction });
			for (const failOn of ["UPDATE discord.voice_sessions", "add_voice_time", "record_daily_voice_time"]) {
				await assert.rejects(trackVoiceLeave("fixture-guild", "fixture-user", "Fixture", {
					now: () => joinedAt + 5_000,
					transaction: (operation) => withTransaction((query) => operation(async (sql, values) => {
						const result = await query(sql, values);
						if (sql.includes(failOn)) throw new Error("injected write failure");
						return result;
					}), applicationPool),
				}, "room"), /injected write failure/);
				const totals = await client.query("SELECT total_voice_time, voice_join_count FROM discord.user_activity WHERE user_id = 'fixture-user'");
				assert.equal(totals.rows[0].total_voice_time, "0");
				assert.equal(totals.rows[0].voice_join_count, "1");
				const session = await client.query("SELECT left_at FROM discord.voice_sessions WHERE user_id = 'fixture-user'");
				assert.equal(session.rows[0].left_at, null);
			}
			await Promise.all([1, 2].map(() => trackVoiceLeave("fixture-guild", "fixture-user", "Fixture", { now: () => joinedAt + 5_000, transaction }, "room")));
			const totals = await client.query("SELECT total_voice_time FROM discord.user_activity WHERE user_id = 'fixture-user'");
			assert.equal(totals.rows[0].total_voice_time, "5");
			const daily = await client.query("SELECT voice_time_seconds FROM discord.daily_activity WHERE user_id = 'fixture-user'");
			assert.equal(daily.rows[0].voice_time_seconds, 5);
			await trackVoiceJoin("fixture-guild", "fixture-user", "Fixture", "new-room", "New room", { now: () => joinedAt + 6_000, transaction });
			await trackVoiceLeave("fixture-guild", "fixture-user", "Fixture", { now: () => joinedAt + 7_000, transaction }, "room");
			const open = await client.query("SELECT channel_id FROM discord.voice_sessions WHERE user_id = 'fixture-user' AND left_at IS NULL");
			assert.deepEqual(open.rows, [{ channel_id: "new-room" }]);
		});

		await context.test("message counters roll back together when daily tracking fails", async () => {
			const { withTransaction } = await import("../core/transaction.ts");
			const { trackMessage } = await import("../core/activityTracker.ts");
			await assert.rejects(trackMessage("fixture-guild", "message-user", "Fixture", {
				now: Date.now,
				transaction: (operation) => withTransaction((query) => operation(async (sql, values) => {
					const result = await query(sql, values);
					if (sql.includes("record_daily_activity")) throw new Error("daily write failed");
					return result;
				}), applicationPool),
			}), /daily write failed/);
			const result = await client.query("SELECT * FROM discord.user_activity WHERE user_id = 'message-user'");
			assert.equal(result.rows.length, 0);
		});
		await context.test("birthday delivery preparation is concurrent-safe, date-only, grouped, and replay-safe", async () => {
			const { createBirthdayDeliveryStore } = await import("../core/birthdayDeliveryStore.ts");
			const store = createBirthdayDeliveryStore(applicationPool);
			await client.query(`INSERT INTO discord.birthdays (discord_id, name, dob)
				SELECT 8000 + n, 'Recovery fixture', '1990-09-06'::date FROM generate_series(1, 26) n`);
			const birthdaysBefore = (await client.query("SELECT id, discord_id, name, dob::text FROM discord.birthdays ORDER BY id")).rows;
			await Promise.all([store.prepare("800", "801", "2026-09-06"), store.prepare("800", "801", "2026-09-06")]);
			const pending = await store.pending("800", "2026-09-06");
			assert.deepEqual(pending.map((row) => row.recipient_ids.length).sort((a, b) => a - b), [1, 25]);
			assert.equal(new Set(pending.flatMap((row) => row.recipient_ids)).size, 26);
			assert.ok(pending.every((row) => row.occurrence_date === "2026-09-06" && row.channel_id === "801"));
			const sql = await readFile(new URL("013_birthday_delivery_tracking.sql", migrationsDirectory), "utf8");
			await client.query(sql);
			assert.deepEqual(await store.pending("800", "2026-09-06"), pending);
			assert.equal((await store.prepare("800", "999", "2026-09-06")).created, 0);
			assert.deepEqual((await client.query("SELECT id, discord_id, name, dob::text FROM discord.birthdays ORDER BY id")).rows, birthdaysBefore);
			const otherYear = await store.prepare("800", "801", "2027-09-06");
			assert.equal(otherYear.created, 26);
			assert.equal(otherYear.expired, 2);
			assert.equal((await store.pending("800", "2026-09-06")).length, 0);
			assert.equal((await store.prepare("900", "901", "2026-09-06")).created, 26);
			assert.equal((await store.prepare("800", "801", "2027-02-28")).created, 0);
			assert.equal((await store.prepare("800", "801", "2027-03-01")).created, 0);
			assert.equal((await store.prepare("800", "801", "2028-02-29")).created, 2);
		});

		await context.test("birthday claims survive reconnect, block duplicate sends, and serialize reconciliation", async () => {
			const { createBirthdayDeliveryStore } = await import("../core/birthdayDeliveryStore.ts");
			const store = createBirthdayDeliveryStore(applicationPool);
			const row = (await store.pending("900", "2026-09-06"))[0];
			const results = await Promise.all([store.claim(row.id), store.claim(row.id)]);
			assert.deepEqual(results.sort(), [false, true]);
			assert.equal(await createBirthdayDeliveryStore(applicationPool).claim(row.id), false);
			assert.equal(await store.claimRecovery(row.id), false);
			await client.query("UPDATE discord.birthday_deliveries SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [row.id]);
			const recoveries = await Promise.all([store.claimRecovery(row.id), store.claimRecovery(row.id)]);
			assert.deepEqual(recoveries.sort(), [false, true]);
			assert.equal(await store.claim(row.id), false);
			assert.equal(await store.sent(row.id, "123456"), true);
			assert.equal(await store.sent(row.id, "123456"), false);
			await store.uncertain(row.id);
			const stored = (await client.query("SELECT status, message_id, attempts FROM discord.birthday_deliveries WHERE id = $1", [row.id])).rows[0];
			assert.deepEqual(stored, { status: "sent", message_id: "123456", attempts: 1 });
			await assert.rejects(client.query(`INSERT INTO discord.birthday_occurrences (guild_id, discord_id, occurrence_date, delivery_id)
				VALUES ($1, $2, $3, $4)`, [row.guild_id, row.recipient_ids[0], row.occurrence_date, row.id]), /duplicate key/);
		});

		await context.test("birthday retry backoff persists and definitely unsent claims can be recovered", async () => {
			const { createBirthdayDeliveryStore } = await import("../core/birthdayDeliveryStore.ts");
			const store = createBirthdayDeliveryStore(applicationPool);
			const row = (await store.pending("900", "2026-09-06"))[0];
			await store.defer(row.id);
			assert.equal(await store.claim(row.id), false);
			const first = (await client.query("SELECT attempts, EXTRACT(EPOCH FROM (next_attempt_at - updated_at))::int AS delay FROM discord.birthday_deliveries WHERE id = $1", [row.id])).rows[0];
			assert.deepEqual(first, { attempts: 1, delay: 300 });
			await client.query("UPDATE discord.birthday_deliveries SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [row.id]);
			await store.defer(row.id);
			const second = (await client.query("SELECT EXTRACT(EPOCH FROM (next_attempt_at - updated_at))::int AS delay FROM discord.birthday_deliveries WHERE id = $1", [row.id])).rows[0];
			assert.equal(second.delay, 600);
			await client.query("UPDATE discord.birthday_deliveries SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [row.id]);
			assert.equal(await store.claim(row.id), true);
			await store.releaseUnsent(row.id);
			assert.equal(await store.claim(row.id), true);
			await store.uncertain(row.id);
			assert.equal(await store.claim(row.id), false);
		});

		await context.test("new birthdays added later today are queued without repeating reserved recipients", async () => {
			const { createBirthdayDeliveryStore } = await import("../core/birthdayDeliveryStore.ts");
			const store = createBirthdayDeliveryStore(applicationPool);
			await client.query("INSERT INTO discord.birthdays (discord_id, name, dob) VALUES (8999, 'Added later fixture', '2001-09-06')");
			assert.equal((await store.prepare("900", "901", "2026-09-06")).created, 1);
			const rows = await store.pending("900", "2026-09-06");
			assert.equal(rows.length, 1);
			assert.deepEqual(rows[0].recipient_ids, ["8999"]);
		});

		await context.test("birthday reservation failure rolls back the announcement batch as well", async () => {
			const { createBirthdayDeliveryStore } = await import("../core/birthdayDeliveryStore.ts");
			await client.query(`CREATE FUNCTION discord.fail_recovery_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN RAISE EXCEPTION 'Injected occurrence failure'; END $$`);
			await client.query(`CREATE TRIGGER fail_recovery_fixture BEFORE INSERT ON discord.birthday_occurrences
				FOR EACH ROW WHEN (NEW.guild_id = '990') EXECUTE FUNCTION discord.fail_recovery_fixture()`);
			const store = createBirthdayDeliveryStore(applicationPool);
			await assert.rejects(store.prepare("990", "991", "2026-09-06"), /Injected occurrence failure/);
			assert.equal((await client.query("SELECT id FROM discord.birthday_deliveries WHERE guild_id = '990'")).rows.length, 0);
			assert.equal((await client.query("SELECT delivery_id FROM discord.birthday_occurrences WHERE guild_id = '990'")).rows.length, 0);
		});
	}
	finally {
		try {
			await applicationPool.end();
			await client.end();
		}
		finally {
			try {
				// Only drop the randomly named database this invocation created.
				if (created) await administrator.query(`DROP DATABASE "${database}"`);
			}
			finally {
				await administrator.end();
			}
		}
	}
});
