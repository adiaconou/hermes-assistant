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
import { listEvents, createEvent, AuthRequiredError } from './services/google/calendar.js';
import { generateAuthUrl } from './routes/auth.js';
import { getUserConfigStore, type UserConfig } from './services/user-config/index.js';

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

  return `You are a quick-response classifier for an SMS assistant. Analyze the user's message and decide how to respond.

${timeContext}

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

You can access the user's Google Calendar using the get_calendar_events and create_calendar_event tools.

If a calendar tool returns auth_required: true, tell the user to tap the link to connect their Google Calendar. Be natural about it, e.g., "To access your calendar, tap this link: [url]"

When listing events, format them concisely for SMS. Example:
- 9am: Team standup
- 2pm: Dentist appointment
- 5pm: Dinner with Sarah

**IMPORTANT - Timezone handling for calendar events:**
When the user mentions a time (e.g., "3:30 PM Sunday"), they mean their LOCAL time. Check their timezone in User Context above and convert to ISO 8601 with the correct UTC offset. For example:
- America/Los_Angeles (PST): "2026-01-19T15:30:00-08:00"
- America/New_York (EST): "2026-01-19T15:30:00-05:00"
If timezone is unknown, ask the user before creating calendar events.`;

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
    description: "Get events from the user's Google Calendar. Use for schedule queries, finding free time, checking availability.",
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string',
          description: 'Start of time range (ISO 8601, e.g. "2025-01-20T00:00:00")',
        },
        end_date: {
          type: 'string',
          description: 'End of time range (ISO 8601). Defaults to end of start_date day if not provided.',
        },
      },
      required: ['start_date'],
    },
  },
  {
    name: 'create_calendar_event',
    description: "Create a new event on the user's Google Calendar.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Event title',
        },
        start_time: {
          type: 'string',
          description: 'Start time (ISO 8601)',
        },
        end_time: {
          type: 'string',
          description: 'End time (ISO 8601). Defaults to 1 hour after start if not provided.',
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
];

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
  phoneNumber?: string
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
 */
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[],
  phoneNumber?: string,
  userConfig?: UserConfig | null
): Promise<string> {
  const anthropic = getClient();

  // Convert history to Anthropic format
  const messages: MessageParam[] = conversationHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  // Build system prompt with user context
  const userContext = buildUserContext(userConfig ?? null);
  const systemPrompt = SYSTEM_PROMPT + userContext;

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
    tools: TOOLS,
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
          phoneNumber
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
      tools: TOOLS,
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
