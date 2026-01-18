# Phase 3: LLM Integration

## Goal

Replace hardcoded echo responses with Claude-generated responses.

---

## Success Criteria

```
1. User texts a question → receives intelligent response from Claude
2. Last 50 conversation turns stored in memory per phone number
3. Errors surfaced directly in SMS for troubleshooting
```

---

## Scope

### In Scope
- [x] Anthropic Claude API integration
- [x] In-memory conversation history (last 50 turns per phone number)
- [x] Error messages surfaced directly to SMS

### Out of Scope (Future Phases)
- Persistent conversation storage
- Multiple LLM provider support
- MCP tools integration
- Google services integration

---

## Technical Implementation

### 1. New Files

```
src/
├── llm.ts              # Anthropic SDK wrapper
└── conversation.ts     # In-memory conversation store
```

### 2. Dependencies

```bash
npm install @anthropic-ai/sdk
```

### 3. Conversation Store (`src/conversation.ts`)

- Map of phone number → array of messages
- Keep last 50 messages per phone number
- Memory clears on server restart (fine for now)

### 4. LLM Module (`src/llm.ts`)

- Wrap Anthropic SDK
- System prompt for SMS assistant
- Pass conversation history to Claude

### 5. Config Changes (`src/config.ts`)

- Add `ANTHROPIC_API_KEY` environment variable

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Testing Checklist

- [ ] Send SMS → receive Claude response
- [ ] Ask follow-up question → context maintained
- [ ] Trigger error → error message in SMS

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-18 | Initial Phase 3 spec |
