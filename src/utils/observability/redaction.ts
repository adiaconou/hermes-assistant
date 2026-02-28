const SECRET_KEY_PATTERN = /(token|secret|password|api[_-]?key|authorization|cookie|credential|encryption[_-]?key|auth[_-]?tag|client[_-]?secret)/i;
const PHONE_KEY_PATTERN = /(phone|from|to|sender|recipient)/i;
const CONTENT_KEY_PATTERN = /^(message|body|content|emailBody|messages|systemPrompt|prompt)$/i;

const PHONE_PATTERN = /(\+?\d[\d\s\-()]{6,}\d)/g;

type RedactOptions = {
  depth?: number;
};

function maskPhoneMatch(match: string): string {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function redactStringByKey(key: string | undefined, value: string): string {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  if (key && CONTENT_KEY_PATTERN.test(key)) {
    return `[REDACTED_TEXT len=${value.length}]`;
  }
  if (key && PHONE_KEY_PATTERN.test(key)) {
    return redactPhone(value);
  }
  return value.replace(PHONE_PATTERN, maskPhoneMatch);
}

function redactUnknown(
  value: unknown,
  key?: string,
  options: RedactOptions = {},
): unknown {
  const depth = options.depth ?? 0;
  if (depth > 6) return '[TRUNCATED]';

  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactStringByKey(key, value.message),
      stack: process.env.NODE_ENV === 'development' ? value.stack : undefined,
    };
  }

  if (typeof value === 'string') {
    return redactStringByKey(key, value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    if (key && CONTENT_KEY_PATTERN.test(key)) {
      return `[REDACTED_ARRAY len=${value.length}]`;
    }
    return value.map((item) => redactUnknown(item, key, { depth: depth + 1 }));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(obj)) {
      if (SECRET_KEY_PATTERN.test(childKey)) {
        result[childKey] = '[REDACTED]';
        continue;
      }
      result[childKey] = redactUnknown(childValue, childKey, { depth: depth + 1 });
    }
    return result;
  }

  return String(value);
}

export function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

export function redactSecrets<T>(value: T): T {
  return redactUnknown(value) as T;
}

export function safeSnippet(value: string, maxLength = 140): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...(truncated)`;
}

