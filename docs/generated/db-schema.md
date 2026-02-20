# Database Schema

> **Generated from source code** — Last updated: 2026-02-18
>
> Source files: `src/services/credentials/sqlite.ts`, `src/services/conversation/sqlite.ts`, `src/services/memory/sqlite.ts`, `src/services/user-config/sqlite.ts`, `src/services/scheduler/sqlite.ts`, `src/services/email-watcher/sqlite.ts`

---

## credentials.db

### credentials

```sql
CREATE TABLE IF NOT EXISTS credentials (
  phone_number TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_data BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (phone_number, provider)
);
```

### email_skills

```sql
CREATE TABLE IF NOT EXISTS email_skills (
  id              TEXT PRIMARY KEY,
  phone_number    TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  match_criteria  TEXT NOT NULL,
  extract_fields  TEXT,           -- JSON array
  action_type     TEXT NOT NULL,
  action_prompt   TEXT NOT NULL,
  tools           TEXT,           -- JSON array
  enabled         INTEGER DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(phone_number, name)
);
```

---

## conversation.db

### conversation_messages

```sql
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  created_at INTEGER NOT NULL,
  memory_processed INTEGER NOT NULL DEFAULT 0,
  memory_processed_at INTEGER,
  media_attachments TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_phone
  ON conversation_messages(phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_unprocessed
  ON conversation_messages(memory_processed, created_at)
  WHERE memory_processed = 0;
```

### conversation_message_metadata

```sql
CREATE TABLE IF NOT EXISTS conversation_message_metadata (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_metadata_message
  ON conversation_message_metadata(message_id);

CREATE INDEX IF NOT EXISTS idx_message_metadata_phone_kind
  ON conversation_message_metadata(phone_number, kind, created_at DESC);
```

---

## memory.db

### user_facts

```sql
CREATE TABLE IF NOT EXISTS user_facts (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  fact TEXT NOT NULL,
  category TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_type TEXT NOT NULL DEFAULT 'explicit',
  evidence TEXT,
  last_reinforced_at INTEGER,
  extracted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_facts_phone
  ON user_facts(phone_number);
```

---

## user_config.db

### user_config

```sql
CREATE TABLE IF NOT EXISTS user_config (
  phone_number TEXT PRIMARY KEY,
  name TEXT,
  timezone TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Migrations (added via ALTER TABLE)
ALTER TABLE user_config ADD COLUMN email_watcher_history_id TEXT;
ALTER TABLE user_config ADD COLUMN email_watcher_enabled INTEGER DEFAULT 0;
```

---

## scheduler.db

### scheduled_jobs

```sql
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'sms',
  user_request TEXT,
  prompt TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Migration (added via ALTER TABLE)
ALTER TABLE scheduled_jobs ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run
  ON scheduled_jobs(enabled, next_run_at);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_phone
  ON scheduled_jobs(phone_number);
```

---

## Summary

| Database | Tables | Indexes |
|----------|--------|---------|
| credentials.db | 2 (credentials, email_skills) | 0 |
| conversation.db | 2 (conversation_messages, conversation_message_metadata) | 4 |
| memory.db | 1 (user_facts) | 1 |
| user_config.db | 1 (user_config) | 0 |
| scheduler.db | 1 (scheduled_jobs) | 2 |
| **Total** | **7** | **7** |

All databases use `better-sqlite3`. Timestamps are stored as INTEGER (milliseconds for conversation/memory, seconds for scheduler). UUIDs stored as TEXT.
