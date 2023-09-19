const Birthdays = require('./models/birthdays');

// Force = Wipes db and starts fresh
Birthdays.sync({ force: true });

// Alter = Adds new tables to db
// Birthdays.sync({ alter: true });