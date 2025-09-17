# Caitlyn Discord Bot

Caitlyn is a modular JavaScript bot that connects to a **local LLM** and interacts with users as if it were a regular Discord user.  
It’s built to be easy to extend, with clear organization for commands, events, jobs, and handlers.

## Features
- Acts like a **Discord user** powered by a local LLM
- Clean folder structure (`core`, `commands`, `events`, `jobs`, `handlers`, `messages`)
- Docker support
- ESLint configuration for consistent code style

## Getting Started

### Install & Run
```
git clone https://github.com/RazeViana/Caitlyn.git
cd Caitlyn
npm install
node main.js
```

### Run with Docker
```
docker build -t caitlyn .
docker run caitlyn
```

### Project Structure
```
Caitlyn/
├── core/        # Core utilities
├── commands/    # Commands
├── events/      # Event logic
├── handlers/    # Business logic
├── jobs/        # Scheduled tasks
├── messages/    # Message templates
├── main.js      # Entry point
└── Dockerfile   # Container setup
```
