const assert = require("node:assert/strict");
const { test } = require("node:test");

const addBirthday = require("../commands/user/addbirthday.ts");
const removeBirthday = require("../commands/user/removebirthday.ts");
const showBirthdays = require("../commands/user/showbirthdays.ts");

test("preserves birthday slash command names", () => {
	assert.equal(addBirthday.data.name, "addbirthday");
	assert.equal(removeBirthday.data.name, "removebirthday");
	assert.equal(showBirthdays.data.name, "showbirthdays");
});
