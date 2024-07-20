const { generalChatId, giphyAPIKey } = require("../config.json");
const axios = require("axios");
const format = require("date-fns/format");

module.exports = {
  async CreateBirthdayEmbed(user, userDateOfBirth, channel) {
    // Get random gif from giphy
    const birthdayGiphy = await axios.get(
      `https://api.giphy.com/v1/gifs/random?api_key=${giphyAPIKey}&tag=birthday`
    );

    const birthdayGif = birthdayGiphy.data.data.images.original.url;

    let userAgeYearsOld =
      new Date().getFullYear() - userDateOfBirth.getFullYear();

    const birthdayEmbed = {
      title: `🎉 Birthday Reminder <#${generalChatId}>! 🎉`,
      color: 16776960,
      fields: [
        {
          name: "🍰 Name:",
          value: `<@${user.userId}>`,
          inline: true,
        },
        {
          name: "🎂 Date:",
          value:
            format(userDateOfBirth, "MMM dd") +
            ", " +
            userAgeYearsOld +
            " years old!",
          inline: true,
        },
      ],
      image: {
        url: birthdayGif ?? "",
      },
      footer: {
        text: "Don't forget to send them my regards 🥳",
        icon_url: "https://i.imgur.com/n8FlP3v.png",
      },
    };

    const isUserBirthday = (userDateOfBirth) => {
      const userDayOfBirth = format(userDateOfBirth, "dd");
      const userMonthOfBirth = format(userDateOfBirth, "MM");

      const today = new Date();
      const todayDay = format(today, "dd");
      const todayMonth = format(today, "MM");

      return userDayOfBirth === todayDay && userMonthOfBirth === todayMonth;
    };

    if (isUserBirthday(userDateOfBirth)) {
      channel.send({ embeds: [birthdayEmbed] });
    }
  },
};
