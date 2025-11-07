# Caitlyn Discord Bot

Caitlyn is a modular Discord bot that integrates with **Open WebUI** and local LLMs to interact naturally as a conversational Discord user. Built with Discord.js v14 and PostgreSQL with vector embeddings for advanced conversation memory.

## Features

### AI Integration
- Powered by **Open WebUI** for LLM interactions
- **Vector-based conversation memory** using PostgreSQL + pgvector
- Semantic search for relevant conversation context
- Per-channel conversation history
- Runtime AI toggle (`/toggleai` command)

### User Activity Tracking
- Message count tracking
- Voice channel join/leave tracking
- Voice time duration tracking
- Daily/weekly/monthly activity streaks
- Detailed activity statistics with averages
- Activity leaderboards
- Streak leaderboards

### Birthday Management
- Add/remove birthday reminders
- Automatic birthday notifications
- List all upcoming birthdays
- Age calculation

### Social Media Enhancements
- Twitter/X video embedding
- Instagram link conversion
- Reddit link conversion
- TikTok link conversion

### Other Features
- Clean ES Module architecture
- Dynamic command/event handlers
- Scheduled cron jobs
- Docker support
- ESLint configuration
- Database migrations system

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ with pgvector extension
- Open WebUI instance (or Ollama)
- Discord bot token

### Installation

1. Clone the repository:
```bash
git clone https://github.com/RazeViana/Caitlyn.git
cd Caitlyn
```

2. Install dependencies:
```bash
npm install
```

3. Set up PostgreSQL with pgvector:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS discord;
```

4. Configure environment variables (see Configuration section below)

5. Deploy commands to Discord:
```bash
npm run deploy
```

6. Start the bot:
```bash
node main.js
```

### Run with Docker
```bash
docker build -t caitlyn .
docker run caitlyn
```

## Configuration

Create a `.env` file with the following variables:

```env
# Discord Configuration
TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id

# Open WebUI Configuration
LLM_ENABLED=true
OLLAMA_MODEL=gemma3:12b
WEBUI_API_KEY=your_api_key
WEBUI_CHAT_ENDPOINT=http://localhost:8080/api/chat/completions
WEBUI_ENABLE_WEB_SEARCH=false
WEBUI_ENABLE_MEMORY=false

# Embedding Configuration
EMBEDDING_MODEL=embeddinggemma:300m
EMBEDDING_ENDPOINT=http://localhost:11434/api/embeddings
CONTEXT_RECENT_COUNT=8
CONTEXT_SIMILAR_COUNT=3

# Conversation Settings
CONVERSATION_MEMORY_SIZE=100

# PostgreSQL Configuration
PGHOST=localhost
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=caitlyn
PGPORT=5432
```

## Available Commands

### User Commands
- `/activity [user]` - View detailed activity statistics for a user
- `/addbirthday` - Add a birthday reminder
- `/removebirthday` - Remove a birthday reminder
- `/showbirthdays` - List all upcoming birthdays

### Utility Commands
- `/ping` - Check bot latency
- `/server` - Display server information
- `/user [user]` - Display user information
- `/reload <command>` - Reload a command (admin only)
- `/toggleai` - Toggle AI responses on/off (admin only)
- `/leaderboard [limit]` - View activity leaderboard
- `/streaks [limit]` - View streak leaderboard

## Project Structure

```
Caitlyn/
├── commands/           # Slash commands
│   ├── user/          # User-related commands
│   └── utility/       # Utility commands
├── core/              # Core utilities
│   ├── createPGPool.js        # PostgreSQL connection
│   ├── logger.js              # Logging utility
│   ├── ollama.js              # LLM communication
│   ├── aiState.js             # AI state management
│   ├── activityTracker.js     # Activity tracking
│   └── vectorMemory.js        # Vector-based memory
├── events/            # Discord event handlers
├── handlers/          # Business logic handlers
├── jobs/              # Scheduled tasks (cron jobs)
├── messages/          # Message processors
├── migrations/        # Database migrations
├── scripts/           # Utility scripts
├── main.js           # Entry point
└── Dockerfile        # Container setup
```

## Database Schema

### Tables
- **discord.messages** - Stores messages with vector embeddings for semantic search
- **discord.user_activity** - Aggregate user activity statistics
- **discord.daily_activity** - Daily activity records for streak calculation
- **discord.voice_sessions** - Detailed voice session history
- **discord.birthdays** - Birthday reminders

## Development

### Linting
```bash
npx eslint .
```

### Running Migrations
```bash
node scripts/runMigration.js <migration_file.sql>
```

### Code Style
- Tabs for indentation
- Double quotes for strings
- Semicolons required
- Stroustrup brace style
- ES Module syntax (import/export)

---

## Changelog

### [Unreleased] - 2025-11-07
#### Added
- User activity tracking system with message counts, voice joins, and voice time
- Daily/weekly/monthly activity streak tracking
- `/activity` command with detailed stats and averages
- `/leaderboard` command for top active users
- `/streaks` command for top streak users
- Per-day activity tracking in `daily_activity` table
- Average messages per day and average voice time per day statistics

#### Fixed
- Weekly/monthly streak calculation to only count complete periods
- Daily activity tracking to properly record messages and voice time separately
- Streak calculation functions now start from previous week/month instead of current

### [2025-11-07] - User Activity System
#### Added
- Complete user activity tracking system (commit bb5ef22)
- Voice state tracking with duration calculation
- Message count tracking
- Database schema for activity tracking (migrations 003-008)

### [2025-11-07] - AI Toggle Command
#### Added
- `/toggleai` command for runtime AI enable/disable (commit 01fcf2c)
- `aiState.js` for runtime state management
- Admin-only permission requirement

### [2025-11-07] - Vector Memory Implementation
#### Added
- PostgreSQL + pgvector integration for conversation memory (commit 36529f6)
- Semantic similarity search for relevant conversation context
- 768-dimensional embeddings using embeddinggemma:300m
- Context combining recent + semantically similar messages
- `vectorMemory.js` core module

### [2025-11-07] - Open WebUI Integration
#### Changed
- Refactored from Ollama direct integration to Open WebUI API (commit bbb319b)
- Updated to use OpenAI-compatible chat completions endpoint
- Added web search and memory feature toggles
- System prompt now configured in Open WebUI instead of .env

### [2025-11-06] - Logging System
#### Added
- Winston-based logging system (commit 63c0813)
- `logger.js` core module
- Consistent logging across all modules
- Log levels: error, warn, info, debug

### [2025-11-06] - ES Module Migration
#### Changed
- Refactored entire codebase from CommonJS to ES Modules (commit bfe61dd)
- Updated all `require()` to `import`
- Updated all `module.exports` to `export`
- Updated package.json with `"type": "module"`

### [2025-11-06] - Environment Configuration
#### Changed
- Consolidated dotenv declarations (commit 8192b89)
- Added `.env.example` file
- Removed redundant environment variable loading

### [Earlier Updates]
#### Added
- Initial project setup and Discord bot foundation
- Birthday tracking and reminder system
- Social media link conversion (Twitter, Instagram, Reddit, TikTok)
- Basic LLM integration with conversation memory
- Docker support and CI/CD workflow
- Command reload functionality
- PostgreSQL database integration
- Cron job scheduling system

#### Features
- Twitter/X video embedding with rich embeds
- Birthday notifications with age calculation
- Message handling system with routing
- Event-driven architecture
- Dynamic command and event loading
- Error handling and validation

---

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or suggestions, please open an issue on GitHub.
