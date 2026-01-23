/**
 * LLM integration module.
 *
 * Wraps Anthropic SDK for generating responses with tool support.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Tool,
  ToolUseBlock,
  TextBlock,
  MessageParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import config from './config.js';
import type { Message } from './conversation.js';
import { generatePage, isSuccess, getSizeLimits } from './ui/index.js';
import { listEvents, createEvent, updateEvent, deleteEvent, AuthRequiredError } from './services/google/calendar.js';
import { listEmails, getEmail } from './services/google/gmail.js';
import { generateAuthUrl } from './routes/auth.js';
import { getUserConfigStore, type UserConfig } from './services/user-config/index.js';
import * as chrono from 'chrono-node';
import { Cron } from 'croner';
import {
  createJob,
  getJobById,
  getJobsByPhone,
  updateJob,
  deleteJob,
  parseScheduleToCron,
  parseSchedule,
  cronToHuman,
  getSchedulerDb,
} from './services/scheduler/index.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

const sizeLimits = getSizeLimits();

/**
 * Classification result for determining if async processing is needed.
 */
export interface ClassificationResult {
  needsAsyncWork: boolean;
  immediateResponse: string;
}

/**
 * Options for customizing generateResponse behavior.
 * Used by scheduled job executor to customize system prompt and tools.
 */
export interface GenerateOptions {
  /** Override the default system prompt */
  systemPrompt?: string;
  /** Override the default tools (for restricting available tools) */
  tools?: Tool[];
  /** Message channel (sms or whatsapp) - used for creating scheduled jobs */
  channel?: 'sms' | 'whatsapp';
}

/**
 * Build time context string from user config.
 * Used by both classification and main response generation.
 */
function buildTimeContext(userConfig: UserConfig | null): string {
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
function buildClassificationPrompt(userConfig: UserConfig | null): string {
  const toolSummary = TOOLS.map(t => `- ${t.name}: ${(t.description || '').split('\n')[0]}`).join('\n');
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
 * Quickly classify a message to determine if it needs async processing.
 * This is a fast call without tools to minimize latency.
 */
export async function classifyMessage(
  userMessage: string,
  conversationHistory: Message[],
  userConfig?: UserConfig | null
): Promise<ClassificationResult> {
  const anthropic = getClient();

  // Convert history to Anthropic format (keep it short for speed)
  const recentHistory = conversationHistory.slice(-4);
  const messages: MessageParam[] = recentHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  console.log(JSON.stringify({
    level: 'info',
    message: 'Classifying message',
    messageLength: userMessage.length,
    timestamp: new Date().toISOString(),
  }));

  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: buildClassificationPrompt(userConfig ?? null),
      messages,
    });

    const textBlock = response.content.find(
      (block): block is TextBlock => block.type === 'text'
    );

    const responseText = textBlock?.text || '';

    console.log(JSON.stringify({
      level: 'info',
      message: 'Classification response received',
      durationMs: Date.now() - startTime,
      responseLength: responseText.length,
      timestamp: new Date().toISOString(),
    }));

    // Parse JSON response
    const parsed = JSON.parse(responseText) as ClassificationResult;

    console.log(JSON.stringify({
      level: 'info',
      message: 'Classification result',
      needsAsyncWork: parsed.needsAsyncWork,
      immediateResponseLength: parsed.immediateResponse.length,
      timestamp: new Date().toISOString(),
    }));

    return parsed;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Classification failed, defaulting to async',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Default to async processing with a generic ack on failure
    return {
      needsAsyncWork: true,
      immediateResponse: "✨ Let me work on that for you!",
    };
  }
}

const SYSTEM_PROMPT = `You are a helpful SMS assistant. Keep responses concise since you communicate via SMS. Be direct and helpful.

When it fits naturally, include a relevant emoji to make responses more visually engaging (e.g., 📅 for calendar, ✅ for confirmations, 🛒 for shopping). Don't force it—skip emojis for simple or serious responses.

## UI Generation Capability

You can generate interactive web pages for the user using the generate_ui tool. Use this when the user asks for:
- Lists they can check off (grocery lists, todo lists, packing lists)
- Interactive forms or calculators
- Any content that benefits from visual presentation or state persistence

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

If a calendar tool returns auth_required: true, tell the user to tap the link to connect their Google Calendar. Be natural about it, e.g., "To access your calendar, tap this link: [url]"

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

If a Gmail tool returns auth_required: true, tell the user to tap the link to connect their Google account.

When listing emails, format them concisely for SMS:
- Show sender name (not full email), subject, and relative time
- Keep it scannable

Example response for "Any new emails?":
"You have 3 unread emails:
1. John Smith - Project update (2h ago)
2. Amazon - Your order shipped (5h ago)
3. Mom - Dinner Sunday? (yesterday)"

For reading full emails, summarize if the content is long.`;

/**
 * Tool definitions for the LLM.
 */
const TOOLS: Tool[] = [
  {
    name: 'generate_ui',
    description: `Generate an interactive web page for the user. Use this for lists, forms, calculators, or any content that benefits from visual presentation. The page will be served at a short URL that the user can open in their browser.

IMPORTANT CONSTRAINTS:
- The page runs in a strict sandbox with NO network access
- No fetch(), XMLHttpRequest, WebSocket, or external resources allowed
- Use localStorage via window.hermesLoadState() and window.hermesSaveState() for persistence
- Keep HTML/CSS/JS concise and mobile-friendly
- Do NOT use external fonts, images, or scripts`,
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Page title (shown in browser tab)',
        },
        html: {
          type: 'string',
          description: 'HTML body content (not full document, just body contents)',
        },
        css: {
          type: 'string',
          description: 'Optional CSS styles (will be added to <style> tag)',
        },
        js: {
          type: 'string',
          description: 'Optional JavaScript (will be added to <script> tag). Use hermesLoadState/hermesSaveState for persistence.',
        },
      },
      required: ['title', 'html'],
    },
  },
  {
    name: 'get_calendar_events',
    description: "Get events from the user's Google Calendar. IMPORTANT: Use the current date/time from User Context to determine 'today', 'tomorrow', etc. Include the user's timezone offset in all dates.",
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string',
          description: 'Start of time range. MUST be ISO 8601 with timezone offset (e.g. "2026-01-20T00:00:00-08:00" for PST, "2026-01-20T00:00:00-05:00" for EST). Use the timezone from User Context.',
        },
        end_date: {
          type: 'string',
          description: 'End of time range. MUST include timezone offset. Defaults to end of start_date day if not provided.',
        },
      },
      required: ['start_date'],
    },
  },
  {
    name: 'create_calendar_event',
    description: "Create a new event on the user's Google Calendar. IMPORTANT: Use the user's timezone from User Context.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Event title',
        },
        start_time: {
          type: 'string',
          description: 'Start time. MUST be ISO 8601 with timezone offset (e.g. "2026-01-20T15:30:00-08:00" for 3:30 PM PST).',
        },
        end_time: {
          type: 'string',
          description: 'End time with timezone offset. Defaults to 1 hour after start if not provided.',
        },
        location: {
          type: 'string',
          description: 'Location (optional)',
        },
      },
      required: ['title', 'start_time'],
    },
  },
  {
    name: 'update_calendar_event',
    description: "Update an existing event on the user's Google Calendar. Use get_calendar_events first to find the event ID.",
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: {
          type: 'string',
          description: 'The event ID to update (from get_calendar_events)',
        },
        title: {
          type: 'string',
          description: 'New event title (optional)',
        },
        start_time: {
          type: 'string',
          description: 'New start time with timezone offset (optional)',
        },
        end_time: {
          type: 'string',
          description: 'New end time with timezone offset (optional)',
        },
        location: {
          type: 'string',
          description: 'New location (optional)',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: "Delete an event from the user's Google Calendar. Use get_calendar_events first to find the event ID. Ask for confirmation before deleting.",
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: {
          type: 'string',
          description: 'The event ID to delete (from get_calendar_events)',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'set_user_config',
    description: `Store user preferences. Call this when the user tells you:
- Their name ("I'm John", "Call me Sarah", "My name is Mike")
- Their timezone ("I'm in Pacific time", "EST", "I live in New York", "I'm in London")
- When they want to update these ("Call me Mike instead", "I moved to New York")`,
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: "User's preferred name or nickname",
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone identifier (e.g., "America/New_York", "America/Los_Angeles", "Europe/London"). Convert user input like "Pacific time" or "EST" to proper IANA format.',
        },
      },
    },
  },
  {
    name: 'delete_user_data',
    description: 'Delete all stored user data when user requests it (e.g., "forget me", "delete my data"). This removes their name, timezone, and preferences.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'resolve_date',
    description: `ALWAYS use this tool to convert relative dates to absolute ISO 8601 dates before calling calendar tools.

Examples of when to use this:
- "sunday" → returns the actual date of next Sunday
- "tomorrow at 3pm" → returns tomorrow's date with 15:00 time
- "next tuesday" → returns the correct date
- "in 2 hours" → returns current time + 2 hours

Call this BEFORE create_calendar_event or get_calendar_events when the user gives a relative date/time. Use the returned ISO string directly in calendar tool calls.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string',
          description: 'The natural language date/time to resolve (e.g., "sunday", "tomorrow at 3pm", "next week")',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone for the result (e.g., "America/Los_Angeles"). Use the timezone from User Context.',
        },
      },
      required: ['input', 'timezone'],
    },
  },
  {
    name: 'create_scheduled_job',
    description: `Create a scheduled message that will be generated and sent to the user.
Works for both one-time and recurring schedules - the system auto-detects based on the schedule.

One-time examples: "tomorrow at 9am", "in 2 hours", "next Friday at 3pm"
Recurring examples: "daily at 9am", "every Monday at noon", "every weekday at 8:30am"

Use this for SMS/text reminders. For calendar events, use create_calendar_event instead.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        user_request: {
          type: 'string',
          description: "The user's original request in their own words. Used for display when listing jobs.",
        },
        prompt: {
          type: 'string',
          description: "What should be generated and sent. Be specific. Example: 'Generate a brief morning summary including today's calendar events'",
        },
        schedule: {
          type: 'string',
          description: "When to run, in natural language. Examples: 'daily at 9am', 'every weekday at 8:30am', 'every Monday at noon', 'every hour'",
        },
      },
      required: ['prompt', 'schedule'],
    },
  },
  {
    name: 'list_scheduled_jobs',
    description: 'List all scheduled jobs for the current user. Shows what recurring tasks are set up.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_scheduled_job',
    description: 'Update an existing scheduled job. Can change the prompt, schedule, or pause/resume the job.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: {
          type: 'string',
          description: 'The job ID to update',
        },
        prompt: {
          type: 'string',
          description: 'New prompt for what to generate (optional)',
        },
        schedule: {
          type: 'string',
          description: 'New schedule in natural language (optional)',
        },
        enabled: {
          type: 'boolean',
          description: 'Set to false to pause, true to resume (optional)',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'delete_scheduled_job',
    description: 'Delete a scheduled job permanently.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: {
          type: 'string',
          description: 'The job ID to delete',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'get_emails',
    description: `Search and retrieve emails from the user's Gmail inbox.

Use for checking unread emails, finding emails from specific senders, or searching by subject/content.

Query examples:
- "is:unread" - unread emails
- "from:john@example.com" - emails from John
- "subject:meeting" - emails about meetings
- "newer_than:1d" - emails from last 24 hours
- "has:attachment" - emails with attachments
- Combine: "is:unread from:boss"

Returns sender, subject, date, and preview snippet.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query (default: "is:unread"). Examples: "is:unread", "from:boss@company.com"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum emails to return (default: 5, max: 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_email',
    description: `Get the full content of a specific email by its ID.

Use after get_emails when the user wants to read the full message, not just the preview.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        email_id: {
          type: 'string',
          description: 'The email ID from get_emails',
        },
      },
      required: ['email_id'],
    },
  },
];

/**
 * Read-only tools safe for scheduled job execution.
 * These tools can gather information but not modify user data.
 */
export const READ_ONLY_TOOLS = TOOLS.filter((t) =>
  ['get_calendar_events', 'resolve_date', 'get_emails', 'read_email'].includes(t.name)
);

/**
 * Helper to get end of day for a date.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Validate an IANA timezone string.
 */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle a tool call from the LLM.
 */
async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  phoneNumber?: string,
  options?: GenerateOptions
): Promise<string> {
  console.log(JSON.stringify({
    level: 'info',
    message: 'Tool call received',
    toolName,
    inputKeys: Object.keys(toolInput),
    timestamp: new Date().toISOString(),
  }));

  if (toolName === 'generate_ui') {
    const { title, html, css, js } = toolInput as {
      title: string;
      html: string;
      css?: string;
      js?: string;
    };

    console.log(JSON.stringify({
      level: 'info',
      message: 'Generating UI page',
      title,
      htmlLength: html?.length || 0,
      cssLength: css?.length || 0,
      jsLength: js?.length || 0,
      timestamp: new Date().toISOString(),
    }));

    try {
      const result = await generatePage({ title, html, css, js });

      console.log(JSON.stringify({
        level: 'info',
        message: 'Page generation result',
        success: isSuccess(result),
        result: isSuccess(result) ? { shortUrl: result.shortUrl } : { error: result.error },
        timestamp: new Date().toISOString(),
      }));

      if (isSuccess(result)) {
        return JSON.stringify({
          success: true,
          shortUrl: result.shortUrl,
          pageId: result.pageId,
          generatedCode: {
            html,
            css: css || '',
            js: js || '',
          },
        });
      } else {
        return JSON.stringify({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Page generation failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'get_calendar_events') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { start_date, end_date } = toolInput as {
      start_date: string;
      end_date?: string;
    };

    try {
      const startDate = new Date(start_date);
      const endDate = end_date ? new Date(end_date) : endOfDay(startDate);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Fetching calendar events',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      const events = await listEvents(phoneNumber, startDate, endDate);

      return JSON.stringify({ success: true, events });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        const authUrl = generateAuthUrl(phoneNumber);
        return JSON.stringify({
          success: false,
          auth_required: true,
          auth_url: authUrl,
        });
      }
      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar query failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'create_calendar_event') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { title, start_time, end_time, location } = toolInput as {
      title: string;
      start_time: string;
      end_time?: string;
      location?: string;
    };

    try {
      const start = new Date(start_time);
      // Default to 1 hour if no end time
      const end = end_time ? new Date(end_time) : new Date(start.getTime() + 3600000);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Creating calendar event',
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      const event = await createEvent(phoneNumber, title, start, end, location);

      return JSON.stringify({ success: true, event });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        const authUrl = generateAuthUrl(phoneNumber);
        return JSON.stringify({
          success: false,
          auth_required: true,
          auth_url: authUrl,
        });
      }
      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event creation failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'update_calendar_event') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { event_id, title, start_time, end_time, location } = toolInput as {
      event_id: string;
      title?: string;
      start_time?: string;
      end_time?: string;
      location?: string;
    };

    try {
      const updates: {
        title?: string;
        start?: Date;
        end?: Date;
        location?: string;
      } = {};

      if (title !== undefined) updates.title = title;
      if (start_time !== undefined) updates.start = new Date(start_time);
      if (end_time !== undefined) updates.end = new Date(end_time);
      if (location !== undefined) updates.location = location;

      console.log(JSON.stringify({
        level: 'info',
        message: 'Updating calendar event',
        eventId: event_id,
        hasTitle: !!title,
        hasStart: !!start_time,
        hasEnd: !!end_time,
        hasLocation: !!location,
        timestamp: new Date().toISOString(),
      }));

      const event = await updateEvent(phoneNumber, event_id, updates);

      return JSON.stringify({ success: true, event });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        const authUrl = generateAuthUrl(phoneNumber);
        return JSON.stringify({
          success: false,
          auth_required: true,
          auth_url: authUrl,
        });
      }
      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event update failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'delete_calendar_event') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { event_id } = toolInput as { event_id: string };

    try {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Deleting calendar event',
        eventId: event_id,
        timestamp: new Date().toISOString(),
      }));

      await deleteEvent(phoneNumber, event_id);

      return JSON.stringify({ success: true, deleted: event_id });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        const authUrl = generateAuthUrl(phoneNumber);
        return JSON.stringify({
          success: false,
          auth_required: true,
          auth_url: authUrl,
        });
      }
      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event deletion failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'set_user_config') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { name, timezone } = toolInput as {
      name?: string;
      timezone?: string;
    };

    // Validate timezone if provided
    if (timezone && !isValidTimezone(timezone)) {
      return JSON.stringify({
        success: false,
        error: `Invalid timezone: "${timezone}". Use IANA format like "America/New_York" or "America/Los_Angeles".`,
      });
    }

    try {
      const store = getUserConfigStore();
      const updates: Partial<UserConfig> = {};
      if (name !== undefined) updates.name = name;
      if (timezone !== undefined) updates.timezone = timezone;

      await store.set(phoneNumber, updates);

      console.log(JSON.stringify({
        level: 'info',
        message: 'User config updated',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        hasName: !!name,
        hasTimezone: !!timezone,
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({
        success: true,
        updated: { name: !!name, timezone: !!timezone },
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to update user config',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'delete_user_data') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    try {
      const store = getUserConfigStore();
      await store.delete(phoneNumber);

      console.log(JSON.stringify({
        level: 'info',
        message: 'User data deleted',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({ success: true, message: 'All user data has been deleted.' });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to delete user data',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'resolve_date') {
    const { input, timezone } = toolInput as {
      input: string;
      timezone: string;
    };

    // Validate timezone
    if (!isValidTimezone(timezone)) {
      return JSON.stringify({
        success: false,
        error: `Invalid timezone: "${timezone}". Use IANA format like "America/New_York" or "America/Los_Angeles".`,
      });
    }

    try {
      // Get current time to use as reference
      const now = new Date();

      // Parse the natural language date with chrono
      // Use forwardDate: true to prefer future dates (e.g., "sunday" means next Sunday, not last Sunday)
      const results = chrono.parse(input, now, { forwardDate: true });

      if (results.length === 0) {
        return JSON.stringify({
          success: false,
          error: `Could not parse date/time from: "${input}"`,
        });
      }

      const parsed = results[0];
      const startDate = parsed.start.date();
      const endDate = parsed.end?.date() || null;

      // Format as ISO 8601 with timezone offset
      const formatWithOffset = (date: Date, tz: string): string => {
        // Get the offset in minutes for the target timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        const parts = formatter.formatToParts(date);
        const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

        const year = getPart('year');
        const month = getPart('month');
        const day = getPart('day');
        const hour = getPart('hour');
        const minute = getPart('minute');
        const second = getPart('second');

        // Calculate offset
        const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
        const offsetMs = tzDate.getTime() - utcDate.getTime();
        const offsetMins = Math.round(offsetMs / 60000);
        const offsetHours = Math.floor(Math.abs(offsetMins) / 60);
        const offsetRemMins = Math.abs(offsetMins) % 60;
        const offsetSign = offsetMins >= 0 ? '+' : '-';
        const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetRemMins).padStart(2, '0')}`;

        return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`;
      };

      const result: { success: boolean; start: string; end?: string; parsed_text: string } = {
        success: true,
        start: formatWithOffset(startDate, timezone),
        parsed_text: parsed.text,
      };

      if (endDate) {
        result.end = formatWithOffset(endDate, timezone);
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'Date resolved',
        input,
        timezone,
        result: result.start,
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify(result);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to resolve date',
        input,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'create_scheduled_job') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { user_request, prompt, schedule } = toolInput as {
      user_request?: string;
      prompt: string;
      schedule: string;
    };

    // Validate prompt length (max 1000 chars)
    if (!prompt || prompt.length === 0) {
      return JSON.stringify({ success: false, error: 'Prompt is required' });
    }
    if (prompt.length > 1000) {
      return JSON.stringify({ success: false, error: 'Prompt is too long (max 1000 characters)' });
    }

    // Get user timezone
    const userConfigStore = getUserConfigStore();
    const userConfig = await userConfigStore.get(phoneNumber);
    const timezone = userConfig?.timezone ?? 'UTC';

    // Parse schedule (auto-detects recurring vs one-time)
    const parsed = parseSchedule(schedule, timezone);
    if (!parsed) {
      return JSON.stringify({
        success: false,
        error: `Could not parse schedule: "${schedule}". Try formats like "daily at 9am", "tomorrow at 3pm", "in 2 hours"`,
      });
    }

    // Calculate next run time
    try {
      let nextRun: Date;
      let cronExpression: string;
      let scheduleDescription: string;

      if (parsed.type === 'recurring') {
        cronExpression = parsed.cronExpression!;

        // For interval patterns (every N hours/minutes), the first run should be
        // N units from now, not at the next aligned time
        const hourIntervalMatch = cronExpression.match(/^0 \*\/(\d+) \* \* \*$/);
        const minuteIntervalMatch = cronExpression.match(/^\*\/(\d+) \* \* \* \*$/);

        if (hourIntervalMatch) {
          // Every N hours - first run is N hours from now
          const hours = parseInt(hourIntervalMatch[1], 10);
          nextRun = new Date(Date.now() + hours * 60 * 60 * 1000);
        } else if (minuteIntervalMatch) {
          // Every N minutes - first run is N minutes from now
          const minutes = parseInt(minuteIntervalMatch[1], 10);
          nextRun = new Date(Date.now() + minutes * 60 * 1000);
        } else {
          // Standard cron - use croner to calculate next run
          const cron = new Cron(cronExpression, { timezone });
          const cronNextRun = cron.nextRun();
          if (!cronNextRun) {
            return JSON.stringify({
              success: false,
              error: 'Could not calculate next run time for this schedule',
            });
          }
          nextRun = cronNextRun;
        }

        scheduleDescription = cronToHuman(cronExpression);
      } else {
        // One-time reminder
        cronExpression = '@once';
        nextRun = new Date(parsed.runAtTimestamp! * 1000);
        scheduleDescription = 'one-time reminder';
      }

      const nextRunAt = Math.floor(nextRun.getTime() / 1000);
      const db = getSchedulerDb();
      const channel = options?.channel ?? 'sms';
      const job = createJob(db, {
        phoneNumber,
        channel,
        userRequest: user_request,
        prompt,
        cronExpression,
        timezone,
        nextRunAt,
        isRecurring: parsed.type === 'recurring',
      });

      const nextRunFormatted = nextRun.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

      console.log(JSON.stringify({
        level: 'info',
        message: parsed.type === 'recurring' ? 'Scheduled job created' : 'One-time reminder created',
        jobId: job.id,
        type: parsed.type,
        cronExpression,
        timezone,
        nextRunAt: nextRun.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({
        success: true,
        job_id: job.id,
        type: parsed.type,
        schedule_description: scheduleDescription,
        next_run: nextRunFormatted,
        timezone,
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to create scheduled job',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'list_scheduled_jobs') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    try {
      const db = getSchedulerDb();
      const jobs = getJobsByPhone(db, phoneNumber);

      if (jobs.length === 0) {
        return JSON.stringify({
          success: true,
          jobs: [],
          message: 'No scheduled jobs found',
        });
      }

      const jobList = jobs.map((job) => ({
        job_id: job.id,
        description: job.userRequest || (job.prompt.length > 50 ? job.prompt.slice(0, 50) + '...' : job.prompt),
        type: job.isRecurring ? 'recurring' : 'one-time',
        schedule: job.isRecurring ? cronToHuman(job.cronExpression) : 'one-time',
        enabled: job.enabled,
        next_run: job.enabled && job.nextRunAt
          ? new Date(job.nextRunAt * 1000).toLocaleString('en-US', {
              timeZone: job.timezone,
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : 'paused',
      }));

      return JSON.stringify({
        success: true,
        jobs: jobList,
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to list scheduled jobs',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'update_scheduled_job') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { job_id, prompt, schedule, enabled } = toolInput as {
      job_id: string;
      prompt?: string;
      schedule?: string;
      enabled?: boolean;
    };

    try {
      const db = getSchedulerDb();
      const job = getJobById(db, job_id);

      if (!job) {
        return JSON.stringify({ success: false, error: 'Job not found' });
      }

      if (job.phoneNumber !== phoneNumber) {
        return JSON.stringify({ success: false, error: 'Job not found' });
      }

      const updates: Record<string, unknown> = {};

      if (prompt !== undefined) {
        updates.prompt = prompt;
      }

      if (enabled !== undefined) {
        updates.enabled = enabled;
      }

      // Recalculate next_run_at when re-enabling a job (unless schedule is also being updated)
      if (enabled === true && schedule === undefined) {
        const cron = new Cron(job.cronExpression, { timezone: job.timezone });
        const nextRun = cron.nextRun();
        if (nextRun) {
          updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
        }
      }

      if (schedule !== undefined) {
        const cronExpression = parseScheduleToCron(schedule);
        if (!cronExpression) {
          return JSON.stringify({
            success: false,
            error: `Could not parse schedule: "${schedule}"`,
          });
        }
        updates.cronExpression = cronExpression;

        // Recalculate next run time
        const cron = new Cron(cronExpression, { timezone: job.timezone });
        const nextRun = cron.nextRun();
        if (nextRun) {
          updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
        }
      }

      const updatedJob = updateJob(db, job_id, updates);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Scheduled job updated',
        jobId: job_id,
        updates: Object.keys(updates),
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({
        success: true,
        job_id,
        updated_fields: Object.keys(updates),
        enabled: updatedJob?.enabled,
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to update scheduled job',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'delete_scheduled_job') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { job_id } = toolInput as { job_id: string };

    try {
      const db = getSchedulerDb();
      const job = getJobById(db, job_id);

      if (!job) {
        return JSON.stringify({ success: false, error: 'Job not found' });
      }

      if (job.phoneNumber !== phoneNumber) {
        return JSON.stringify({ success: false, error: 'Job not found' });
      }

      deleteJob(db, job_id);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Scheduled job deleted',
        jobId: job_id,
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({
        success: true,
        message: 'Job deleted successfully',
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to delete scheduled job',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'get_emails') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { query, max_results } = toolInput as {
      query?: string;
      max_results?: number;
    };

    try {
      const emails = await listEmails(phoneNumber, {
        query: query || 'is:unread',
        maxResults: Math.min(max_results || 5, 10),
      });

      console.log(JSON.stringify({
        level: 'info',
        message: 'Fetched emails',
        count: emails.length,
        query: query || 'is:unread',
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({
        success: true,
        count: emails.length,
        emails: emails.map((e) => ({
          id: e.id,
          from: e.from,
          subject: e.subject,
          snippet: e.snippet,
          date: e.date,
          unread: e.isUnread,
        })),
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        const authUrl = generateAuthUrl(phoneNumber);
        return JSON.stringify({
          success: false,
          auth_required: true,
          auth_url: authUrl,
        });
      }
      console.error(JSON.stringify({
        level: 'error',
        message: 'Email fetch failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (toolName === 'read_email') {
    if (!phoneNumber) {
      return JSON.stringify({ success: false, error: 'Phone number not available' });
    }

    const { email_id } = toolInput as { email_id: string };

    try {
      const email = await getEmail(phoneNumber, email_id);

      if (!email) {
        return JSON.stringify({ success: false, error: 'Email not found' });
      }

      // Truncate body for SMS-friendly response
      const maxBodyLength = 500;
      const truncatedBody = email.body.length > maxBodyLength
        ? email.body.substring(0, maxBodyLength) + '...'
        : email.body;

      console.log(JSON.stringify({
        level: 'info',
        message: 'Read email',
        emailId: email_id,
        bodyLength: email.body.length,
        timestamp: new Date().toISOString(),
      }));

      return JSON.stringify({
        success: true,
        email: {
          from: email.from,
          subject: email.subject,
          date: email.date,
          body: truncatedBody,
        },
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        const authUrl = generateAuthUrl(phoneNumber);
        return JSON.stringify({
          success: false,
          auth_required: true,
          auth_url: authUrl,
        });
      }
      console.error(JSON.stringify({
        level: 'error',
        message: 'Email read failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

/**
 * Build user context section for system prompt.
 */
function buildUserContext(userConfig: UserConfig | null): string {
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

  return `\n\n## User Context
- Name: ${name || 'not set'}
- Timezone: ${timezone || 'not set'}
- ${timeContext}${setupPrompt}`;
}

/**
 * Generate a response using Claude with tool support.
 * @param userMessage - The user's message
 * @param conversationHistory - Previous conversation messages
 * @param phoneNumber - User's phone number (for calendar tools)
 * @param userConfig - User's stored configuration (name, timezone)
 * @param options - Optional overrides for system prompt and tools
 */
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[],
  phoneNumber?: string,
  userConfig?: UserConfig | null,
  options?: GenerateOptions
): Promise<string> {
  const anthropic = getClient();

  // Convert history to Anthropic format
  const messages: MessageParam[] = conversationHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  // Build system prompt - use provided or build default with user context
  const timeContext = buildTimeContext(userConfig ?? null);
  const systemPrompt = options?.systemPrompt
    ?? (`**${timeContext}**\n\n` + SYSTEM_PROMPT + buildUserContext(userConfig ?? null));

  // Use provided tools or default
  const tools = options?.tools ?? TOOLS;

  // Initial API call
  console.log(JSON.stringify({
    level: 'info',
    message: 'Calling Anthropic API',
    messageCount: messages.length,
    timestamp: new Date().toISOString(),
  }));

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    tools,
    messages,
  });

  console.log(JSON.stringify({
    level: 'info',
    message: 'Anthropic API response',
    stopReason: response.stop_reason,
    contentTypes: response.content.map(b => b.type),
    timestamp: new Date().toISOString(),
  }));

  // Handle tool use loop
  let loopCount = 0;
  const MAX_TOOL_LOOPS = 5;

  while (response.stop_reason === 'tool_use') {
    loopCount++;

    if (loopCount > MAX_TOOL_LOOPS) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Tool loop limit reached',
        loopCount,
        timestamp: new Date().toISOString(),
      }));
      break;
    }

    console.log(JSON.stringify({
      level: 'info',
      message: 'Processing tool use loop',
      loopCount,
      timestamp: new Date().toISOString(),
    }));

    const toolUseBlocks = response.content.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use'
    );

    // Process all tool calls
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        const result = await handleToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          phoneNumber,
          options
        );
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: result,
        };
      })
    );

    // Add assistant response and tool results to messages
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // Continue the conversation
    console.log(JSON.stringify({
      level: 'info',
      message: 'Continuing conversation after tool use',
      loopCount,
      timestamp: new Date().toISOString(),
    }));

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    console.log(JSON.stringify({
      level: 'info',
      message: 'Anthropic API response after tool',
      stopReason: response.stop_reason,
      contentTypes: response.content.map(b => b.type),
      timestamp: new Date().toISOString(),
    }));
  }

  // Extract final text response
  const textBlock = response.content.find(
    (block): block is TextBlock => block.type === 'text'
  );

  console.log(JSON.stringify({
    level: 'info',
    message: 'Returning final response',
    hasTextBlock: !!textBlock,
    responseLength: textBlock?.text?.length || 0,
    timestamp: new Date().toISOString(),
  }));

  return textBlock?.text || 'I could not generate a response.';
}
