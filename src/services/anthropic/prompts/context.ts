/**
 * Context builders for user memory and time.
 */

import type { UserConfig } from '../../user-config/index.js';
import { getMemoryStore } from '../../memory/index.js';

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
