---
name: sample-reminder-helper
description: Help the user create reminders and follow-ups from conversational requests.
metadata:
  hermes:
    channels: [sms, whatsapp]
    tools: [create_scheduled_job, list_scheduled_jobs, resolve_date]
    match:
      - "remind me"
      - "set a reminder"
      - "follow up"
---

# Reminder Helper

When invoked, help the user create a reminder or follow-up.

## Steps

1. Parse the user's message for what they want to be reminded about and when.
2. Use `resolve_date` to convert relative times to absolute timestamps.
3. Use `create_scheduled_job` to schedule the reminder.
4. Confirm the reminder was created with the exact date and time.

## Guidelines

- If the user doesn't specify a time, ask for clarification.
- Always confirm the timezone with the user's configured timezone.
- Keep reminder text concise — it will be sent via SMS.
