# Hermes Assistant

An SMS-based personal assistant powered by Claude (Anthropic) with Google service integrations.

## Features

Text your assistant and it will:

- **Calendar Management** - Create, update, delete Google Calendar events
- **Email Access** - Read and search Gmail
- **Reminders** - One-time and recurring reminders with natural language scheduling
- **Memory** - Remembers context about you across conversations
- **Dynamic UI** - Generates interactive web pages for complex responses
- **Timezone Aware** - All scheduling respects your timezone with DST handling

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Development (with hot reload + ngrok tunnel)
npm run dev

# Production
npm run build && npm start

# Run tests
npm test
```

## Project Structure

```
hermes-assistant/
├── src/
│   ├── index.ts              # Express server entry point
│   ├── config.ts             # Environment configuration
│   ├── conversation.ts       # Conversation management
│   ├── twilio.ts             # Twilio SMS client
│   ├── llm/                  # LLM integration
│   │   ├── index.ts          # Message processing with tool loop
│   │   ├── client.ts         # Anthropic SDK wrapper
│   │   ├── prompts/          # System prompts and context
│   │   └── tools/            # Tool definitions
│   │       ├── calendar.ts   # Google Calendar operations
│   │       ├── email.ts      # Gmail operations
│   │       ├── scheduler.ts  # Reminder management
│   │       ├── memory.ts     # User facts/preferences
│   │       ├── user-config.ts# Timezone and settings
│   │       └── ui.ts         # Dynamic page generation
│   ├── routes/
│   │   ├── sms.ts            # Twilio webhook handler
│   │   ├── auth.ts           # OAuth callback routes
│   │   └── pages.ts          # UI page serving
│   ├── services/
│   │   ├── scheduler/        # Cron jobs and reminders
│   │   ├── google/           # Calendar and Gmail clients
│   │   ├── memory/           # Persistent user memory
│   │   ├── conversation/     # Conversation history
│   │   ├── credentials/      # OAuth token storage
│   │   ├── user-config/      # User preferences
│   │   └── date/             # Date parsing and resolution
│   └── ui/                   # Dynamic UI generation
├── tests/                    # Unit and integration tests
├── docs/                     # Specifications and plans
└── dist/                     # Compiled output
```

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | Twilio API token |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number |
| `ANTHROPIC_API_KEY` | Claude API key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte hex key for token encryption |

## Deployment

**Target platform:** Railway

```bash
# Via Railway CLI
railway init && railway up

# Or connect GitHub repo for auto-deploy on push
```

Configuration is in `railway.toml`.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design, request flow, timezone handling
- [AGENTS.md](./AGENTS.md) - AI agent guidelines and coding conventions
- [docs/](./docs/) - Feature specs and implementation plans

## Development

```bash
npm run dev          # Server + ngrok tunnel
npm run dev:server   # Server only
npm test             # Run all tests
npm run lint         # Lint code
```

## License

MIT
