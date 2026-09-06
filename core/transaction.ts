/**
 * @file transaction.ts
 * @description Runs related PostgreSQL queries on one checked-out connection in a transaction.
 * Rolls back failures, discards connections after failed rollback, and always releases the client.
 *
 * @module transaction
 */

import { pool } from "./createPGPool.js";

export type Query = (sql: string, values?: unknown[]) => Promise<{
	rows: Record<string, unknown>[];
	rowCount?: number | null;
}>;

export async function withTransaction<T>(operation: (query: Query) => Promise<T>, source = pool): Promise<T> {
	const client = await source.connect();
	let broken = false;
	try {
		await client.query("BEGIN");
		const result = await operation((sql, values) => client.query(sql, values));
		await client.query("COMMIT");
		return result;
	}
	catch (error) {
		try {
			await client.query("ROLLBACK");
		}
		catch {
			broken = true;
		}
		throw error;
	}
	finally {
		client.release(broken);
	}
}
