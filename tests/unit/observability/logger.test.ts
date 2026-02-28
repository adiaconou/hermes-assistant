import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, withLogContext } from '../../../src/utils/observability/index.js';

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe('observability logger', () => {
  it('writes redacted JSON logs to local file in development', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-obs-log-'));
    const logFile = path.join(tempDir, 'app.ndjson');

    process.env.NODE_ENV = 'development';
    process.env.APP_LOG_FILE = logFile;

    const logger = createLogger({ domain: 'unit-test' });
    const stdoutSpy = vi.spyOn(process.stdout, 'write');

    await withLogContext({ requestId: 'req_test_123' }, async () => {
      const body = 'this should not be stored in clear text';
      logger.info('test_event', {
        phone: '+15551234567',
        token: 'super-secret-token',
        body,
      });
    });

    await vi.waitFor(() => {
      expect(fs.existsSync(logFile)).toBe(true);
      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    }, { timeout: 1000 });

    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    const payload = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(payload.event).toBe('test_event');
    expect(payload.level).toBe('info');
    expect(payload.domain).toBe('unit-test');
    expect(payload.requestId).toBe('req_test_123');
    expect(payload.phone).toBe('***4567');
    expect(payload.token).toBe('[REDACTED]');
    expect(payload.body).toBe('[REDACTED_TEXT len=39]');
    expect(stdoutSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('does not write local file sink in production by default', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-obs-log-'));
    const logFile = path.join(tempDir, 'app.ndjson');

    process.env.NODE_ENV = 'production';
    process.env.APP_LOG_FILE = logFile;

    const logger = createLogger({ domain: 'unit-test' });
    logger.info('prod_event', { ok: true });

    expect(fs.existsSync(logFile)).toBe(false);
  });
});
