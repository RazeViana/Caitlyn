const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const format = require("date-fns/format");
const Birthdays = require("../../models/birthdays");

module.exports = {
  cooldown: 10,
  category: "fun",
  data: new SlashCommandBuilder()
    .setName("birthdays")
    .setDescription("Returns a list of all birthdays created"),

  async execute(interaction) {
    try {
      const allBirthdays = await Birthdays.findAll({
        order: [["dob", "ASC"]],
      });

      if (allBirthdays.length === 0) {
        return interaction.reply("No birthdays set :(");
      }

      const birthdayListEmbed = new EmbedBuilder()
        .setTitle("All birthdays")
        .setColor(16776960)
        .setDescription("Here are all the birthdays:")
        .setFooter({
          text: "ggwp old bastards",
          iconURL: "https://i.imgur.com/n8FlP3v.png",
        });
      allBirthdays.forEach((birthday) => {
        birthdayListEmbed.addFields({
          name: birthday.name,
          value: format(birthday.dob, "dd MMMM yyyy"),
        });
      });

      return interaction.reply({ embeds: [birthdayListEmbed] });
    } catch (error) {
      console.error("Error fetching birthdays:", error);
      return interaction.reply("An error occurred while fetching birthdays.");
    }
  },
};
