import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
  vi.resetModules();
});

describe('trace logger requestId continuity', () => {
  it('uses explicit requestId override in development trace file names and content', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-trace-'));
    process.env.NODE_ENV = 'development';
    process.env.TRACE_LOG_DIR = tempDir;

    vi.resetModules();
    const { createTraceLogger } = await import('../../../src/utils/trace-logger.js');

    const requestId = 'req_explicit_1234';
    const logger = createTraceLogger('+15551234567', requestId);
    logger.log('INFO', 'trace continuity test');
    logger.close('SUCCESS');

    const dateDir = new Date().toISOString().slice(0, 10);
    const fullDir = path.join(tempDir, dateDir);
    const files = fs.readdirSync(fullDir);
    const matched = files.find(file => file.includes(requestId));

    expect(matched).toBeDefined();

    const content = fs.readFileSync(path.join(fullDir, matched as string), 'utf-8');
    expect(content).toContain(requestId);
    expect(content).toContain('***4567');
  });
});

