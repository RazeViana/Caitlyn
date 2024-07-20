const CronJob = require("cron").CronJob;
const cronJobManager = require("./cronJobManager");
const format = require("date-fns/format");
const Birthdays = require("../models/birthdays");
const { generalChatId } = require("../config.json");
const { CreateBirthdayEmbed } = require("./CreateBirthdayEmbed");

async function startCronJobs(client) {
  const channel = client.channels.cache.get(generalChatId);
  const allBirthdays = await Birthdays.findAll({
    attributes: ["name", "dob", "userId"],
  });
  let jobsStarted = 0;
  console.log(
    "Starting Crono Jobs for Birthday Reminders.. " +
      allBirthdays.length +
      " in queue."
  );

  for (let i = 0; i < allBirthdays.length; i++) {
    const user = allBirthdays[i];

    const userDateOfBirth = new Date(user.dob);
    const userDayOfBirth = format(userDateOfBirth, "dd");
    const userMonthOfBirth = format(userDateOfBirth, "MM");

    // Create a new cron job for each birthday in the database
    const job = new CronJob(
      // Run the job at 10:00am on the user's birthday
      `0 10 ${userDayOfBirth} ${userMonthOfBirth - 1} *`,
      CreateBirthdayEmbed(user, userDateOfBirth, channel)
    );

    console.log(`Cron Job created for ${user.name}.`);

    cronJobManager.addJob(user.userId, job);

    try {
      job.start();
      jobsStarted = jobsStarted + 1;
    } catch (error) {
      return console.log(
        `Something went wrong with creating cron job for ${user.name}.`
      );
    }
  }
  if (jobsStarted === allBirthdays.length) {
    console.log("All jobs started successfully.");
  }
}

module.exports = startCronJobs;
