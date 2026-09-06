/**
 * @file asyncTools.ts
 * @description Bounds asynchronous operations with a labeled timeout.
 * Clears the deadline timer when the operation settles without cancelling the underlying work.
 *
 * @module asyncTools
 */

export async function withTimeout<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
			}),
		]);
	}
	finally {
		clearTimeout(timer);
	}
}
