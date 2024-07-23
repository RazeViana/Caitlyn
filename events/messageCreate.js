const { Events, EmbedBuilder } = require("discord.js");
const axios = require("axios");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;

    // Changes twitter.com links with the vx at the back
    const twitterBaseURL = "https://x.com";
    const vxtwitterAPIBaseURL = "https://api.vxtwitter.com";

    if (message.content.startsWith(twitterBaseURL)) {
      try {
        const vxTwitterAPI = await axios.get(
          message.content.replace(twitterBaseURL, vxtwitterAPIBaseURL)
        );
        // Checks if twitter post contains a video
        if (vxTwitterAPI.data.mediaURLs.length === 1) {
          if (vxTwitterAPI.data.mediaURLs[0].includes("video")) {
            // Deletes the original message
            await message.delete();

            // Find text content of the tweet
            const textContent = vxTwitterAPI.data.text
              .replace(/https?:\/\/\S+/g, "")
              .trim();

            // Removes emojis from the text content
            const textContentTrim = textContent.replace(
              /([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uFE00-\uFE0F]|\u200D|[\u2600-\u26FF]|\uD83C[\uDDE6-\uDDFF]|\uD83C[\uDFF0-\uDFFF]|\uD83D[\uDC00-\uDE4F]|\uD83D[\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF])/g,
              ""
            );

            // Sends the video link from the api
            if (vxTwitterAPI.data.mediaURLs[0]) {
              if (textContentTrim) {
                await message.channel.send(
                  `[${textContentTrim}](${vxTwitterAPI.data.mediaURLs[0]})`
                );
              } else {
                await message.channel.send(
                  `[Here you go](${vxTwitterAPI.data.mediaURLs[0]})`
                );
              }
            }
          }

          // Checks if twitter post contains an image
          else if (vxTwitterAPI.data.mediaURLs[0].includes("img")) {
            const twitterImageEmbed = new EmbedBuilder()
              .setAuthor({
                name: `@${vxTwitterAPI.data.user_name}`,
                url: vxTwitterAPI.data.tweetURL,
              })
              .setTitle(vxTwitterAPI.data.user_screen_name)
              .setURL(vxTwitterAPI.data.tweetURL)
              .setThumbnail(
                "https://pbs.twimg.com/profile_images/1683899100922511378/5lY42eHs_400x400.jpg"
              )
              .setColor(4506111)
              .setDescription(
                vxTwitterAPI.data.text.replace(/https?:\/\/\S+/g, "")
              )
              .setImage(vxTwitterAPI.data.mediaURLs[0])
              .setFooter({
                text: message.author.tag,
                iconURL: message.author.avatarURL(),
              });

            await message.delete();
            await message.channel.send({ embeds: [twitterImageEmbed] });
          }
        }
      } catch (error) {
        console.error("Error fetching data from vxtwitter API:", error);
      }
    }
  },
};
