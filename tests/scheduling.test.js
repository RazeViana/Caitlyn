const assert = require("node:assert/strict");
const { test } = require("node:test");

function replaceModule(modulePath, exports) {
	const previous = require.cache[modulePath];
	require.cache[modulePath] = {
		id: modulePath,
		filename: modulePath,
		loaded: true,
		exports,
	};

	return () => {
		if (previous) {
			require.cache[modulePath] = previous;
		}
		else {
			delete require.cache[modulePath];
		}
	};
}

test("birthday scheduling registers the daily cron and dispatches the reminder", async () => {
	const cronPath = require.resolve("node-cron");
	const reminderPath = require.resolve("../messages/birthdayReminderMessage.ts");
	const scheduledEventPath = require.resolve("../jobs/birthdayScheduledEvent.ts");
	const scheduled = [];
	const reminders = [];
	const restoreCron = replaceModule(cronPath, {
		schedule(expression, callback) {
			scheduled.push({ expression, callback });
		},
	});
	const restoreReminder = replaceModule(reminderPath, {
		async birthdayReminderMessage(client) {
			reminders.push(client);
		},
	});
	const previousScheduledEvent = require.cache[scheduledEventPath];
	delete require.cache[scheduledEventPath];
	const client = { name: "cron-client" };

	try {
		const { startBirthdayScheduledEvent } = require(scheduledEventPath);

		startBirthdayScheduledEvent(client);

		assert.equal(scheduled.length, 1);
		assert.equal(scheduled[0].expression, "0 9 * * *");
		scheduled[0].callback();
		await Promise.resolve();
		assert.deepEqual(reminders, [client]);
	}
	finally {
		restoreCron();
		restoreReminder();
		if (previousScheduledEvent) {
			require.cache[scheduledEventPath] = previousScheduledEvent;
		}
		else {
			delete require.cache[scheduledEventPath];
		}
	}
});

test("cron handler dispatches birthday scheduling with the client", () => {
	const scheduledEventPath = require.resolve("../jobs/birthdayScheduledEvent.ts");
	const handlerPath = require.resolve("../handlers/cronJobHandler.ts");
	const clients = [];
	const restoreScheduledEvent = replaceModule(scheduledEventPath, {
		startBirthdayScheduledEvent(client) {
			clients.push(client);
		},
	});
	const previousHandler = require.cache[handlerPath];
	delete require.cache[handlerPath];
	const client = { name: "handler-client" };

	try {
		const { startCronJobs } = require(handlerPath);

		startCronJobs(client);

		assert.deepEqual(clients, [client]);
	}
	finally {
		restoreScheduledEvent();
		if (previousHandler) {
			require.cache[handlerPath] = previousHandler;
		}
		else {
			delete require.cache[handlerPath];
		}
	}
});
