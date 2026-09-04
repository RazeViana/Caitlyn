const assert = require("node:assert/strict");
const { test } = require("node:test");
const { socialMediaMessage } = require("../messages/socialMediaMessage.ts");

function createMessage(content) {
	const sent = [];
	let deleted = false;

	return {
		message: {
			content,
			async delete() {
				deleted = true;
			},
			channel: {
				async send(value) {
					sent.push(value);
				},
			},
		},
		wasDeleted: () => deleted,
		sent,
	};
}

test("replaces a supported social URL and deletes the original", async () => {
	const fixture = createMessage("https://x.com/example/status/123");

	await socialMediaMessage(fixture.message);

	assert.equal(fixture.wasDeleted(), true);
	assert.deepEqual(fixture.sent, [
		"[x.com](https://twitterez.com/example/status/123)",
	]);
});

test("leaves unsupported messages untouched", async () => {
	const fixture = createMessage("hello there");

	await socialMediaMessage(fixture.message);

	assert.equal(fixture.wasDeleted(), false);
	assert.deepEqual(fixture.sent, []);
});
