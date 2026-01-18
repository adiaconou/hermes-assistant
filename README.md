# Personal Assistant

An SMS-based personal assistant powered by LLM and MCP tools, with Google service integrations.

## Overview

This assistant runs as a persistent service (locally via Docker, deployable to cloud) and communicates with you via SMS. Send a text message to your assistant's phone number, and it will:

- Process your request using Claude (Anthropic)
- Execute relevant tools via MCP
- Access your Google Calendar, Gmail, and other services
- Respond back via SMS

## Documentation

- [Product Requirements](./docs/requirements.md) - Full PRD and specifications

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials

# Run in development
npm run dev

# Build for production
npm run build
npm start
```

## Project Structure

```
assistant/
├── docs/               # Documentation
│   └── requirements.md # Product requirements
├── src/                # Source code
├── docker/             # Docker configuration
├── .env.example        # Environment template
└── package.json        # Project config
```

## Status

**Phase 1: SMS Echo MVP** ✓ Complete

The assistant is deployed to Railway and responds to SMS messages. See [phase-1-requirements.md](./docs/phase-1-requirements.md) for details.

**Next**: Phase 2 - LLM Integration
