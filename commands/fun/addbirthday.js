const { SlashCommandBuilder } = require("discord.js");
const CronJob = require("cron").CronJob;
const cronJobManager = require("../../utils/cronJobManager");
const format = require("date-fns/format");
const Birthdays = require("../../models/birthdays");
const { generalChatId } = require("../../config.json");
const { CreateBirthdayEmbed } = require("../../utils/CreateBirthdayEmbed");

module.exports = {
  category: "fun",
  data: new SlashCommandBuilder()
    .setName("addbirthday")
    .setDescription("Sets a birthday reminder")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user of the birthday you want to add")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("day")
        .setDescription("The day of the birthday e.g. 28")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("month")
        .setDescription("The month of the birthday")
        .setRequired(true)
        .addChoices(
          { name: "January", value: "1" },
          { name: "February", value: "2" },
          { name: "March", value: "3" },
          { name: "April", value: "4" },
          { name: "May", value: "5" },
          { name: "June", value: "6" },
          { name: "July", value: "7" },
          { name: "August", value: "8" },
          { name: "September", value: "9" },
          { name: "October", value: "10" },
          { name: "November", value: "11" },
          { name: "December", value: "12" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("year")
        .setDescription("The year of the birthday e.g. 1997")
        .setRequired(true)
    ),
  async execute(interaction) {
    const birthdayUser = interaction.options.getUser("user");
    const birthdayDay = interaction.options.getInteger("day");
    const birthdayMonth = interaction.options.getString("month");
    const birthdayYear = interaction.options.getInteger("year");
    const dateOfBirthFormatted = new Date(
      birthdayYear,
      birthdayMonth,
      birthdayDay,
      12,
      0,
      0
    );

    const generalChannel = interaction.client.channels.cache.get(generalChatId);

    // First Check if birthday already exists for that user
    const existingBirthday = await Birthdays.findOne({
      where: { userId: birthdayUser.id },
    });

    if (existingBirthday) {
      return interaction.reply({
        content: `Birthday is already set for ${birthdayUser.username}`,
        ephemeral: true,
      });
    }

    // Create a new cron job for new birthday
    const job = new CronJob(
      // Run the job at 10:00am on the user's birthday
      `0 10 ${birthdayDay} ${birthdayMonth} * `,
      CreateBirthdayEmbed(birthdayUser, dateOfBirthFormatted, generalChannel)
    );

    // Add the job to the cronJobManager
    cronJobManager.addJob(birthdayUser.id, job);
    try {
      const birthday = await Birthdays.create({
        userId: birthdayUser.id,
        name: birthdayUser.username,
        dob: dateOfBirthFormatted.toISOString(),
      });

      job.start();
      return interaction.reply({
        content: `Added birthday for ${
          birthday.name
        }. It is ready and set for ${format(dateOfBirthFormatted, "dd MMMM")}`,
        ephemeral: true,
      });
    } catch (error) {
      return interaction.reply({
        content: "Something went wrong with adding a birthday.",
        ephemeral: true,
      });
    }
  },
};
