# Product Sense

Product direction and user context for Hermes Assistant.

---

## Vision

Hermes is a personal assistant that lives in your SMS inbox. It connects to your Google Workspace (Calendar, Gmail, Drive, Sheets, Docs) and handles tasks through natural conversation — no app to install, no UI to learn.

## Current Capabilities

| Capability | How it works |
|------------|-------------|
| **Calendar management** | Create, update, delete events via natural language |
| **Reminders & recurring tasks** | One-time and cron-based scheduled messages |
| **Email search & read** | Gmail search with natural language queries |
| **Email automation** | Skills-based email watching (tax tracking, expense logging, invite detection) |
| **Memory** | Remembers facts about you across conversations |
| **Drive/Sheets/Docs** | File management, spreadsheet operations, document creation |
| **Image analysis** | Gemini Vision for receipts, photos, documents |
| **Dynamic UI** | Generates interactive HTML pages for complex data |

## User Interaction Patterns

### SMS-First Design

Every interaction starts and ends with SMS. This means:

- **Short responses** — SMS has implicit length expectations. Multi-paragraph replies feel wrong.
- **Async tolerance** — Users expect "I'm working on it" followed by the real response seconds later. The two-phase pattern makes this natural.
- **No visual affordances** — No buttons, no dropdowns, no rich text. When rich display is needed, generate a UI page and send a short URL.
- **Context carries across messages** — Users say "what about tomorrow?" referring to the previous calendar query. The 24h conversation window handles this.

### What Makes a Good Feature

A feature is a good fit for Hermes if it:

1. **Can be triggered by natural language** — "Schedule a meeting with Bob tomorrow at 3pm"
2. **Can be answered via SMS** — The response fits in 1-2 text messages
3. **Integrates with existing Google services** — Calendar, Gmail, Drive, Sheets
4. **Works asynchronously** — The user doesn't need to wait and watch
5. **Benefits from memory** — Knowing the user's timezone, preferences, and context improves the response

### What Doesn't Fit

- Real-time interactions (chat, video, live dashboards)
- Features requiring user authentication beyond Google OAuth
- Anything that needs a persistent UI state across sessions
- High-frequency polling or notifications (SMS costs add up)

## Future Roadmap Themes

- **Skills system** — Generalize email skills to work across SMS, email, and scheduled invocations
- **Multi-user support** — Currently designed for a single user; multi-user would need auth, per-user config isolation, and billing
- **Proactive suggestions** — Use memory to anticipate needs ("You have a meeting in 30 minutes with no location set")
