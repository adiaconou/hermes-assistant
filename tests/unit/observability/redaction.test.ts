import { describe, expect, it } from 'vitest';
import { redactPhone, redactSecrets, safeSnippet } from '../../../src/utils/observability/index.js';

describe('observability redaction', () => {
  it('masks phone numbers to last 4 digits', () => {
    expect(redactPhone('+15551234567')).toBe('***4567');
  });

  it('redacts sensitive keys and message content', () => {
    const input = {
      phone: '+15551234567',
      accessToken: 'abc123',
      body: 'Book dinner with Alex at 8pm',
      nested: {
        client_secret: 'my-secret',
      },
    };

    const redacted = redactSecrets(input);

    expect(redacted.phone).toBe('***4567');
    expect(redacted.accessToken).toBe('[REDACTED]');
    expect(redacted.body).toBe(`[REDACTED_TEXT len=${input.body.length}]`);
    expect((redacted.nested as { client_secret: string }).client_secret).toBe('[REDACTED]');
  });

  it('truncates long snippets safely', () => {
    const value = 'x'.repeat(200);
    const snippet = safeSnippet(value, 20);
    expect(snippet).toBe('xxxxxxxxxxxxxxxxxxxx...(truncated)');
  });
});
