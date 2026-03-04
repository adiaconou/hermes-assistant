---
name: daily-briefing
description: Generate a daily briefing with the last 24 hours of email and upcoming 7 days of calendar events.
metadata:
  hermes:
    channels: [scheduler]
    tools: [get_emails, read_email, get_calendar_events]
    autoSchedule:
      enabled: true
      cron: "30 6 * * *"
      prompt: "Generate my daily briefing for this morning."
---

# Daily Briefing

Create a concise morning briefing with two sections:

1. **Email Summary (Last 24 Hours)**
- Call `get_emails` with query `newer_than:1d in:inbox` (inbox-only, non-archived).
- Read each email body with `read_email` for up to 12 emails.
- Focus on action items, deadlines, requests, and important updates.
- De-emphasize promotional/low-value items.

2. **Calendar Summary (Next 7 Days)**
- Call `get_calendar_events` with `start_date: "today"` and `end_date: "in 7 days"`.
- Group by day and highlight the most important meetings/events.

## Output Rules

- Keep the full message short and scannable for mobile.
- Use exactly these two headers:
  - `Email Summary`
  - `Calendar (Next 7 Days)`
- If either section has no items, explicitly say "No important updates."
- Do not ask follow-up questions.
- If auth is required, include the exact auth URL returned by the tool.
