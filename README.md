# Caitlyn

A Discord bot for activity stats, birthdays and social media posts. It can also chat through Open WebUI, but AI replies are off by default.

## What it does

- **Activity:** counts messages, tracks time in voice channels, and shows leaderboards and activity streaks.
- **Birthdays:** saves birthdays and sends reminders at 9 AM in the configured timezone. If the bot was offline, it checks for missed reminders later that day.
- **Social posts:** turns X, TikTok and public Instagram links into posts with captions, media and credit to the person who shared them. Enable this separately in each channel.
- **Private logs:** sends selected log types to one owner-controlled channel in the main server. Other servers cannot choose a destination or see those logs through the bot.
- **Optional AI chat:** uses Open WebUI, with recent conversation and saved memory when configured.

### Social media

X supports text, images, videos and quoted posts. TikTok supports videos and mobile share links. Instagram supports public photos, reels and carousels, including mixed images and videos, up to eight items.

Media is downloaded, checked and uploaded to Discord. Larger videos can be compressed to fit the upload limit. Long videos may still be too large or take too long to process. The original message is removed only after a complete replacement is confirmed; failed or incomplete previews keep the original.

X uses a self-hosted copy of FxEmbed. Some posts require an authorised X account. Instagram stories and private posts are not supported; explicit private/login responses get a short notice. Reddit is not enabled.

## Commands

Square brackets mean an argument is optional.

| Command | What it does |
| --- | --- |
| `/activity [user]` | Show message counts, voice time and other activity stats. Defaults to you. |
| `/leaderboard [limit]` | Show the activity leaderboard. Defaults to 10 members. |
| `/streaks [limit]` | Show daily, weekly and monthly activity streaks. |
| `/addbirthday user day month year` | Save or update someone's birthday. |
| `/removebirthday user` | Remove a saved birthday. |
| `/showbirthdays` | List saved birthdays by month. |
| `/ping` | Check that the bot responds. |
| `/server` | Show server information. |
| `/user` | Show your username and when you joined the server. |

### Administrator commands

| Command | What it does |
| --- | --- |
| `/social enable` | Enable social previews in the current text channel. |
| `/social disable` | Disable new previews in the current channel. |
| `/social disable-server` | Disable new previews throughout the server. |
| `/social status` | Show the server's social preview settings. |
| `/toggleai` | Turn AI replies on or off until the next restart. Requires configured AI services. |
| `/reload command` | Reload a command module without restarting the bot. |

These logging commands also require the bot application owner:

| Command | What it does |
| --- | --- |
| `/setup logs channel` | Choose the private log channel in the main server. |
| `/setup status` | Show the logging configuration. |
| `/setup disable` | Stop forwarding logs. |
| `/logs levels types` | Choose log types from inside the log channel. For example: `info,warning,error`, `all` or `none`. |
| `/logs status` | Show the selected log types. |

Available log types are `debug`, `info`, `success`, `warning` and `error`. Debug activity logs describe what was collected and saved; they do not include message text or birthday dates.

## Running your own bot

You need a Discord application, Node.js 24 and npm 11. PostgreSQL with pgvector is needed for activity, birthdays, saved AI memory, social jobs and Discord log settings. Docker is also needed for the social media services. Open WebUI and an embeddings service are optional.

1. Clone the repository and run `npm ci`.
2. Copy `.env.example` to `.env`. Set your Discord credentials and the settings for the features you want. Remove unused placeholder values.
3. Prepare the database using the [setup guide](docs/setup.md#database). Back up existing databases and apply only missing migrations.
4. Run `npm run deploy` to register slash commands in the configured server.
5. Run `npm run dev` to start the bot.

Enable **Server Members Intent** and **Message Content Intent** for the bot in the Discord Developer Portal. Invite it with the `bot` and `applications.commands` scopes. Channel permissions and the rest of the configuration are covered in the [setup guide](docs/setup.md).

AI and social previews default to off. Social previews need the media services running, `SOCIAL_MEDIA_ENABLED=true`, and `/social enable` in each chosen channel. Missing optional settings disable the affected feature and produce a startup warning. Restart after changing `.env`.

Run only one bot instance per token. Stop your server instance before using the same bot locally.

## Development

```bash
npm run check    # Typecheck, lint, build and tests
npm run dev     # Run the TypeScript source
npm run build   # Compile into dist/
npm start       # Run the compiled bot
```

Register changed commands with `npm run deploy`, or `npm run deploy:prod` after a build. Command registration is separate from normal bot startup. Global registration is available with `--global`; private logging commands stay guild-only.

See [development conventions](docs/development.md) for file layout, comments, tests and database work. Supporting documentation belongs in `docs/`; this README stays at the repository root.

## Deployment

Pushes to `main` run the checks and publish a matching set of bot, broker, FxEmbed and media-worker images. The mainframe checks for completed releases every five minutes, downloads all four images, updates the app and registers guild commands. Failed startup rolls back to the previous app configuration. Database migration changes pause automatic deployment for review.

See [automatic deployment](docs/automatic-deployment.md) for setup, logs, rollback and release package inventories. Feature branches do not deploy.

## More information

- [Setup and environment variables](docs/setup.md)
- [Social preview setup](docs/social-delivery.md), [TikTok](docs/tiktok.md), [Instagram](docs/instagram.md) and [FxEmbed](docs/fxembed.md)
- [Birthday reminders](docs/birthday-recovery.md)
- [Private logging](docs/discord-logging.md) and [what gets logged](docs/data-logging.md)
- [Feature configuration](docs/feature-configuration.md) and [error handling](docs/resilience.md)
- [Development notes](docs/handoff.md) and [task list](docs/.todo)
- [Vendored FxEmbed licence](docs/licenses/FxEmbed.txt)
