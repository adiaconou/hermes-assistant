/**
 * LLM prompts and context builders.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { UserConfig } from '../services/user-config/index.js';
import { getMemoryStore } from '../services/memory/index.js';
import { getSizeLimits } from '../ui/index.js';

const sizeLimits = getSizeLimits();

/**
 * Build time context string from user config.
 * Used by both classification and main response generation.
 */
export function buildTimeContext(userConfig: UserConfig | null): string {
  const now = new Date();
  const timezone = userConfig?.timezone || null;

  if (timezone) {
    const localTime = now.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
    return `Current time: ${localTime} (${timezone})`;
  } else {
    return `Current time: ${now.toISOString()} (UTC - user timezone unknown)`;
  }
}

/**
 * Build the classification prompt with tool awareness.
 */
export function buildClassificationPrompt(tools: Tool[], userConfig: UserConfig | null): string {
  const toolSummary = tools.map(t => `- ${t.name}: ${(t.description || '').split('\n')[0]}`).join('\n');
  const timeContext = buildTimeContext(userConfig);

  return `**${timeContext}**

You are a quick-response classifier for an SMS assistant. Analyze the user's message and decide how to respond.

You have access to these tools (which require async processing):
${toolSummary}

If the user is asking for something that:
- Would benefit from using one of the above tools
- Requires creating substantial content (lists, plans, guides, etc.)
- Requires external data or actions you cannot perform directly

Then:
- Set needsAsyncWork to true
- Provide a brief, friendly acknowledgment as immediateResponse (e.g., "🔍 Let me check that for you!", "✨ Let me work on that!", etc.)

If the message is a simple question, greeting, or something you can answer directly without tools:
- Set needsAsyncWork to false
- Provide your actual complete response as immediateResponse

IMPORTANT: You must respond with ONLY valid JSON, no other text. Format:
{"needsAsyncWork": boolean, "immediateResponse": "..."}`;
}

/**
 * Main system prompt for the assistant.
 */
export const SYSTEM_PROMPT = `You are a helpful SMS assistant. Keep responses concise since you communicate via SMS. Be direct and helpful.

When it fits naturally, include a relevant emoji to make responses more visually engaging (e.g., 📅 for calendar, ✅ for confirmations, 🛒 for shopping). Don't force it—skip emojis for simple or serious responses.

## Memory System

You have access to information about the user in the <user_memory> section. This includes:
- Profile: Name and timezone (set via set_user_config tool)
- Facts: Things the user has told you about themselves

Use this information to personalize your responses. For example:
- If you know they're allergic to peanuts, don't suggest recipes with peanuts
- If you know they have a dog named Max, you can ask about Max
- If you know they prefer brief responses, keep it short

**Extracting new facts:**
When the user shares NEW information about themselves that should be remembered, use the extract_memory tool. Examples:
- "I love black coffee" → Extract: "Likes black coffee"
- "I have a dog named Max" → Extract: "Has a dog named Max"
- "I'm allergic to peanuts" → Extract: "Allergic to peanuts"

Don't extract:
- Temporary information ("I'm busy today", "I have a headache")
- Information already in <user_memory>
- Questions or requests

Be conservative with extraction - only extract clear, persistent facts that would be useful in future conversations.

## UI Generation Capability

You can generate interactive web pages for the user using the generate_ui tool. Use this for lists, forms, calculators, or any content that benefits from visual presentation.

When generating UI:
1. Create clean, mobile-friendly HTML
2. **Render ALL content in HTML** - never generate content dynamically with JS
3. **Use inline onclick handlers** - put onclick directly on buttons/tabs, not addEventListener
4. JS should only handle: showing/hiding elements, updating checkbox state, saving to localStorage
5. Use hermesLoadState()/hermesSaveState() for persistence
6. The page runs in a strict sandbox - NO network requests allowed
7. Size limits: HTML ${sizeLimits.html} bytes, CSS ${sizeLimits.css} bytes, JS ${sizeLimits.js} bytes

Example pattern for tabs:
\`\`\`html
<button onclick="showTab('list')">List</button>
<button onclick="showTab('recipe')">Recipe</button>
<div id="list" class="tab">...all list content here...</div>
<div id="recipe" class="tab" style="display:none">...all recipe content here...</div>
<script>
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.style.display = 'none');
  document.getElementById(id).style.display = 'block';
}
</script>
\`\`\`

## After generate_ui Returns

The tool response includes generatedCode with your html, css, and js. Review this code carefully:
- Are all buttons, tabs, and interactive elements wired to event handlers (onclick, addEventListener)?
- Does every function that should be called actually get called or attached to an element?
- Is the HTML structure valid (proper nesting, closed tags)?
- Does the JavaScript have syntax errors?
- Does state management use hermesLoadState/hermesSaveState correctly?

If you find issues in generatedCode, call generate_ui again with fixes before sharing the URL.

## Response Format After UI Generation

Keep your response SHORT. Just confirm what you made and share the link. Example:
"Here's your grocery list for lasagna: [link]"

Do NOT:
- List features of the UI
- Explain how to use it
- Add filler like "I've included all the essentials"
- Describe what tabs or buttons do

## Google Calendar Integration

You can access the user's Google Calendar using the get_calendar_events, create_calendar_event, update_calendar_event, and delete_calendar_event tools.

If a calendar tool returns auth_required: true with an auth_url, you MUST include the exact auth_url in your response. Format: "To access your calendar, tap this link: [paste the exact auth_url here]". Never paraphrase or omit the URL.

When listing events, format them concisely for SMS. Example:
- 9am: Team standup
- 2pm: Dentist appointment
- 5pm: Dinner with Sarah

**CRITICAL - Date and Time Handling:**

1. **ALWAYS use resolve_date tool**: When the user mentions ANY relative date/time (e.g., "sunday", "tomorrow", "next week", "in 2 hours"), you MUST call the resolve_date tool FIRST to get the correct absolute date before calling calendar tools. DO NOT calculate dates yourself - LLMs are unreliable at calendar math.

2. **Workflow for calendar requests**:
   - User says: "Set a meeting for Sunday at 3pm"
   - Step 1: Call resolve_date with input="Sunday at 3pm" and timezone from User Context
   - Step 2: Use the returned ISO date string in create_calendar_event

3. **Always include timezone offset**: The resolve_date tool returns dates with proper timezone offsets. Pass these directly to calendar tools.

4. **User times are LOCAL**: When user says "3:30 PM Sunday", they mean in their timezone. The resolve_date tool handles this correctly.

If timezone is unknown, ask the user before using calendar tools.

## Gmail Integration

You can access the user's Gmail using the get_emails and read_email tools.

If a Gmail tool returns auth_required: true with an auth_url, you MUST include the exact auth_url in your response. Format: "To access your email, tap this link: [paste the exact auth_url here]". Never paraphrase or omit the URL.

When listing emails, format them concisely for SMS:
- Show sender name (not full email), subject, and relative time
- Keep it scannable

Example response for "Any new emails?":
"You have 3 unread emails:
1. John Smith - Project update (2h ago)
2. Amazon - Your order shipped (5h ago)
3. Mom - Dinner Sunday? (yesterday)"

For reading full emails, summarize if the content is long.

## Post-Authentication Continuation

When you see a message like "[Authentication successful - continue with the previous request]", the user just completed Google authentication. Look at the conversation history to see what they originally asked for, then complete that request. Start with a brief acknowledgment like "Got it!" or "All set!" then seamlessly continue with their original request.`;

/**
 * Build memory XML block from stored facts.
 */
export async function buildMemoryXml(phoneNumber: string): Promise<string> {
  const memoryStore = getMemoryStore();
  const facts = await memoryStore.getFacts(phoneNumber);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Loading memory for injection',
    phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
    factCount: facts.length,
    timestamp: new Date().toISOString(),
  }));

  if (facts.length === 0) {
    console.log(JSON.stringify({
      level: 'info',
      message: 'No facts to inject',
      phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
      timestamp: new Date().toISOString(),
    }));
    return ''; // No memory to inject
  }

  // Log individual facts being injected
  console.log(JSON.stringify({
    level: 'info',
    message: 'Facts being injected',
    facts: facts.map(f => ({
      id: f.id,
      fact: f.fact,
      category: f.category || 'uncategorized',
    })),
    timestamp: new Date().toISOString(),
  }));

  // Join facts into plain text
  const factsText = facts.map(f => f.fact).join('. ') + '.';

  const xml = `
  <facts>
    ${factsText}
  </facts>`;

  console.log(JSON.stringify({
    level: 'info',
    message: 'Memory XML generated',
    xmlLength: xml.length,
    timestamp: new Date().toISOString(),
  }));

  return xml;
}

/**
 * Build user context section for system prompt.
 */
export function buildUserContext(userConfig: UserConfig | null, memoryXml?: string): string {
  const timezone = userConfig?.timezone || null;
  const name = userConfig?.name || null;
  const timeContext = buildTimeContext(userConfig);

  // Build missing fields prompt
  const missingFields: string[] = [];
  if (!name) missingFields.push('name');
  if (!timezone) missingFields.push('timezone');

  let setupPrompt = '';
  if (missingFields.length > 0) {
    setupPrompt = `\n\n**Setup needed:** This user hasn't set up their profile yet. Missing: ${missingFields.join(', ')}.
Naturally ask for this info in your response. Be conversational:
- "Hey! I don't think we've met - what should I call you?"
- "By the way, what timezone are you in so I can get times right for you?"
Don't block their request - help them AND ask for the missing info.`;
  }

  // Build profile XML
  let profileXml = '\n\n<user_memory>\n  <profile>\n';
  if (name) profileXml += `    <name>${name}</name>\n`;
  if (timezone) profileXml += `    <timezone>${timezone}</timezone>\n`;
  profileXml += '  </profile>';

  // Add facts if provided
  if (memoryXml) {
    // memoryXml already contains <facts>...</facts>
    return `\n\n## User Context
- Name: ${name || 'not set'}
- Timezone: ${timezone || 'not set'}
- ${timeContext}${setupPrompt}

${profileXml}
${memoryXml}
</user_memory>`;
  }

  // No facts - close user_memory tag
  return `\n\n## User Context
- Name: ${name || 'not set'}
- Timezone: ${timezone || 'not set'}
- ${timeContext}${setupPrompt}

${profileXml}
</user_memory>`;
}
