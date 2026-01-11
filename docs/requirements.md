# Personal Assistant - Product Requirements Document

## Status: Draft v0.2

---

## 1. Vision & Goals

### Vision
A personal assistant that lives in your pocket via SMS. No app to install, no interface to learn - just text your assistant like you would a friend, and it handles tasks, retrieves information, and manages your digital life.

### Goals
- **Always Available**: Runs 24/7 as a persistent service
- **Frictionless Interaction**: SMS-based, works on any phone
- **Intelligent**: Powered by LLM with access to tools via MCP
- **Integrated**: Connected to Google services (Gmail, Calendar, etc.)
- **Proactive**: Listens for events and notifies you when action is needed
- **Portable**: Runs locally in Docker, deployable to cloud

### Non-Goals (for v1)
- Voice interaction
- Multi-user support
- Web/mobile UI (future roadmap)

---

## 2. User Stories

### Core Interaction
```
As a user, I can text my assistant's phone number and receive intelligent responses.
```

### Authentication
```
As a user, when I need to connect a service (like Google),
the assistant sends me a link via SMS that I can tap to authenticate.
```

### Task Management
```
As a user, I can ask my assistant to:
- "Remind me to call mom tomorrow at 5pm"
- "What's on my todo list?"
- "Add 'buy groceries' to my tasks"
```

### Calendar
```
As a user, I can ask my assistant to:
- "What's on my calendar today?"
- "Schedule a meeting with John next Tuesday at 2pm"
- "When am I free this week?"
```

### Email
```
As a user, I can ask my assistant to:
- "Do I have any important emails?"
- "Send an email to bob@example.com saying I'll be late"
- "Summarize my unread emails"
```

### Information Retrieval
```
As a user, I can ask my assistant to:
- "What's the weather like?"
- "What time is it in Tokyo?"
- General knowledge questions
```

### Proactive Notifications (Event-Driven)
```
As a user, I receive automatic SMS notifications when:
- A new important email arrives (from VIP contacts or matching keywords)
- A calendar event is starting soon (e.g., 15 min before)
- A reminder I set is due
- A task deadline is approaching
```

### Automation Rules
```
As a user, I can set up automation rules like:
- "Text me when I get an email from my boss"
- "Send me a daily briefing at 8am with my calendar and tasks"
- "Alert me if I get an email with 'urgent' in the subject"
- "Remind me 30 minutes before any meeting"
```

### Quiet Hours
```
As a user, I can configure quiet hours:
- "Don't text me between 10pm and 7am unless it's urgent"
- "Only send urgent notifications on weekends"
```

---

## 3. System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Your Phone                            │
│                     (Send/Receive SMS)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Twilio SMS Gateway                      │
│                   (Webhook to/from service)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Personal Assistant Service                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  Message Router                      │    │
│  │         (Inbound SMS / Outbound Notifications)       │    │
│  └─────────────────────────────────────────────────────┘    │
│         │                                     ▲              │
│         ▼                                     │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Message   │  │    LLM      │  │    MCP Tools        │  │
│  │   Handler   │──│  (Claude)   │──│  (Gmail, GCal, etc) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                                     │              │
│         │         ┌─────────────┐             │              │
│         │         │  Scheduler  │─────────────┤              │
│         │         │  (Cron/Jobs)│             │              │
│         │         └─────────────┘             │              │
│         │                │                    │              │
│         │         ┌─────────────┐             │              │
│         │         │   Event     │◄────────────┘              │
│         │         │  Listener   │  (Polls/Webhooks)          │
│         │         └─────────────┘             │              │
│         │                │                    │              │
│         ▼                ▼                    ▼              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    Auth     │  │ Automation  │  │   Token Storage     │  │
│  │   Manager   │  │   Rules     │  │   (Credentials)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
│    Google APIs (Push/Poll)  │  Other APIs  │  MCP Tools     │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| Message Router | Route inbound SMS to handler, outbound notifications to Twilio |
| Message Handler | Process user SMS requests, generate responses |
| LLM (Claude) | Understand requests, decide actions, generate responses |
| MCP Tools | Execute actions (email, calendar, web search, etc.) |
| Scheduler | Run scheduled jobs (reminders, daily briefings, periodic checks) |
| Event Listener | Poll/receive webhooks for external events (new emails, etc.) |
| Automation Rules | Store and evaluate user-defined automation triggers |
| Auth Manager | Handle OAuth flows, send auth links via SMS |
| Token Storage | Securely store OAuth tokens and credentials |

---

## 4. Core Features

### Priority 1: Foundation
- [ ] **SMS Gateway Integration** - Receive and send SMS via Twilio
- [ ] **LLM Integration** - Connect to Claude API for request processing
- [ ] **Basic Conversation** - Handle simple Q&A without tools

### Priority 2: Google Integration
- [ ] **Google OAuth Flow** - SMS-friendly authentication
- [ ] **Gmail Access** - Read, summarize, send emails
- [ ] **Google Calendar** - Read and create events

### Priority 3: MCP Tool Framework
- [ ] **MCP Server Setup** - Initialize MCP tool infrastructure
- [ ] **Tool Discovery** - Allow LLM to discover available tools
- [ ] **Tool Execution** - Execute tools based on LLM decisions

### Priority 4: Task Management
- [ ] **Todo List** - Persistent task storage
- [ ] **Reminders** - Time-based notifications via SMS

### Priority 5: Event-Driven Automation
- [ ] **Scheduler** - Cron-like job scheduling for periodic tasks
- [ ] **Event Listeners** - Poll/webhook handlers for external events
- [ ] **Gmail Watch** - Detect new emails, filter by sender/subject/keywords
- [ ] **Calendar Watch** - Upcoming event notifications
- [ ] **Automation Rules Engine** - User-defined trigger → action rules
- [ ] **Daily Briefing** - Scheduled summary of calendar, tasks, emails
- [ ] **Quiet Hours** - Suppress non-urgent notifications during set times

### Priority 6: Extended Capabilities
- [ ] **Web Search** - Answer questions using web search
- [ ] **Weather** - Current conditions and forecasts
- [ ] **Notes** - Quick note taking and retrieval

---

## 5. Technical Requirements

### Runtime Environment
- **Language**: TypeScript (Node.js)
- **Runtime**: Node.js 20+
- **Container**: Docker
- **Initial Deployment**: Local Docker
- **Future Deployment**: Cloud (AWS/GCP/etc.)

### External Services
| Service | Purpose | Required |
|---------|---------|----------|
| Twilio | SMS send/receive | Yes |
| Anthropic | Claude LLM API | Yes |
| Google Cloud | OAuth, Gmail, Calendar APIs | Yes |

### Data Storage
- **Tokens**: Encrypted local file or SQLite (v1)
- **Conversation History**: In-memory with optional persistence
- **Tasks/Notes**: Local SQLite database
- **Automation Rules**: SQLite database
- **Scheduled Jobs**: Persistent job queue (SQLite or Redis)

### Event-Driven Architecture

#### Event Sources
| Source | Method | Frequency |
|--------|--------|-----------|
| Gmail | Google Push Notifications (Pub/Sub) or Polling | Real-time or every 1-5 min |
| Google Calendar | Polling (no push for personal calendars) | Every 5 min |
| Reminders | Internal scheduler | On scheduled time |
| Task Deadlines | Internal scheduler | Check every hour |

#### Automation Rules Schema
```typescript
interface AutomationRule {
  id: string;
  name: string;                    // "Email from boss"
  enabled: boolean;
  trigger: {
    type: 'email' | 'calendar' | 'time' | 'task';
    conditions: {
      // For email triggers
      from?: string[];             // ["boss@company.com"]
      subjectContains?: string[];  // ["urgent", "ASAP"]
      // For calendar triggers
      minutesBefore?: number;      // 15
      // For time triggers
      cron?: string;               // "0 8 * * *" (8am daily)
    };
  };
  action: {
    type: 'notify' | 'summarize' | 'custom';
    template?: string;             // "New email from {{from}}: {{subject}}"
    urgency: 'normal' | 'urgent';  // Urgent bypasses quiet hours
  };
  quietHoursExempt: boolean;
}
```

#### Quiet Hours Configuration
```typescript
interface QuietHours {
  enabled: boolean;
  schedule: {
    start: string;     // "22:00"
    end: string;       // "07:00"
    timezone: string;  // "America/Los_Angeles"
    daysOfWeek: number[]; // [0,1,2,3,4,5,6] (0=Sunday)
  };
  allowUrgent: boolean;  // Allow urgent notifications to bypass
}

### Security Considerations
- All tokens encrypted at rest
- HTTPS for all external communications
- Phone number verification for user authentication
- Rate limiting on incoming messages
- No sensitive data in SMS messages (use links instead)

### SMS Authentication Flow
```
1. User texts: "Connect my Gmail"
2. Assistant generates unique auth token
3. Assistant texts: "Tap to connect Gmail: https://assistant.example.com/auth/google?token=xyz"
4. User taps link, completes Google OAuth in browser
5. Service stores tokens, texts back: "Gmail connected!"
```

---

## 6. API & Webhook Design

### Twilio Webhook (Incoming SMS)
```
POST /webhook/sms
Content-Type: application/x-www-form-urlencoded

Body: MessageSid, From, To, Body
Response: TwiML with reply message
```

### OAuth Callback
```
GET /auth/google/callback?code=xxx&state=yyy
Response: HTML page confirming auth success
Side effect: Store tokens, notify user via SMS
```

---

## 7. Configuration

### Environment Variables
```
# Twilio
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER

# User
USER_PHONE_NUMBER

# Anthropic
ANTHROPIC_API_KEY

# Google OAuth
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI

# Server
PORT
NODE_ENV
AUTH_BASE_URL
```

---

## 8. Future Roadmap

### Phase 2: Enhanced Capabilities
- [ ] Multi-turn conversation context
- [ ] Proactive notifications (daily briefings)
- [ ] Voice note transcription
- [ ] Image understanding (MMS)

### Phase 3: Web Interface
- [ ] Admin dashboard
- [ ] Conversation history viewer
- [ ] Settings management
- [ ] Manual tool testing

### Phase 4: Cloud & Scale
- [ ] Cloud deployment (AWS/GCP)
- [ ] Multi-user support
- [ ] Team/family sharing
- [ ] Usage analytics

---

## 9. Open Questions

> Items to resolve as we iterate:

### SMS & Communication
1. **SMS Delivery Reliability**: How to handle failed SMS delivery? Retry logic?
2. **Long Responses**: SMS has 160 char limit - how to split long responses?
3. **Cost Management**: Twilio costs per SMS - any concerns?

### Technical
4. **Rate Limits**: Twilio and Google API rate limits - how to handle?
5. **Conversation Context**: How much history to maintain? Token limits?
6. **Error Handling**: What to text user when things fail?

### Event-Driven & Automation
7. **Gmail Push vs Poll**: Google Pub/Sub requires cloud deployment. Start with polling?
8. **Notification Batching**: Should multiple events be batched into one SMS?
9. **Duplicate Prevention**: How to avoid notifying about the same email twice?
10. **Rule Creation UX**: How should users create automation rules via SMS? Natural language?
11. **Default Rules**: Should there be built-in rules (e.g., calendar reminders) enabled by default?
12. **Event History**: How long to retain event/notification history?
13. **Urgency Detection**: How should the LLM determine if an email is "urgent"?

---

## 10. Success Metrics

- **Responsiveness**: < 5 second response time for simple queries
- **Reliability**: 99% successful message delivery
- **Utility**: User sends 10+ messages/day after first week
- **Accuracy**: 90%+ of requests handled correctly

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.2 | 2025-01-11 | Added event-driven automation, proactive notifications, automation rules, quiet hours |
| 0.1 | 2025-01-11 | Initial draft |
