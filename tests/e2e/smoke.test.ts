import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { E2EHarness } from './harness.js';
import { writeTestReport } from './reporter.js';

const hasApiKey = process.env.ANTHROPIC_API_KEY
  && process.env.ANTHROPIC_API_KEY !== 'test-api-key';

const describeE2E = hasApiKey ? describe : describe.skip;

describeE2E('Smoke test', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = new E2EHarness();
    await harness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('responds to a simple greeting without errors', async () => {
    const result = await harness.sendMessage('Hello!');

    // Write report before assertions so it's captured even on failure
    const reportPath = writeTestReport({
      testName: 'smoke-greeting',
      turns: [{ userMessage: 'Hello!', response: result }],
    });
    console.log(`\n📄 Report: ${reportPath}\n`);

    // Any non-empty response is acceptable
    expect(result.finalResponse).toBeTruthy();
    expect(result.finalResponse.length).toBeGreaterThan(0);
  }, 60_000);
});
