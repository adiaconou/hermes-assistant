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

    // Make orchestrator fallback failures explicit in test output.
    expect(result.finalResponse).not.toContain('I encountered an unexpected error');
    expect(result.finalResponse).not.toContain('Please try again.');

    const verdict = await harness.judgeConversation({
      instructions: `This is a smoke-test greeting scenario.
Focus only on whether the assistant behaved like a friendly, minimal personal assistant for a simple "Hello!" message.
Do not require tool use, long explanations, or task execution.`,
      criteria: [
        'The assistant gives a polite, coherent greeting response to "Hello!".',
        'The response is concise and not empty.',
        'The response does not claim actions were taken that were not requested.',
      ],
    });

    // Write report before assertions so it's captured even on failure
    const reportPath = writeTestReport({
      testName: 'smoke-greeting',
      turns: [{ userMessage: 'Hello!', response: result }],
      verdict,
    });
    console.log(`\n📄 Report: ${reportPath}\n`);

    // WhatsApp always-orchestrate: sync response is empty TwiML
    expect(result.syncResponse).toBe('');

    // Typing indicator was fired with valid MessageSid and stopped after completion
    const typingCalls = harness.getTypingIndicatorCalls();
    expect(typingCalls.length).toBe(1);
    expect(typingCalls[0].messageSid).toMatch(/^SM\d+$/);
    expect(typingCalls[0].stopped).toBe(true);

    // Final response comes from the orchestrator (async path)
    expect(result.finalResponse).toBeTruthy();
    expect(result.finalResponse.length).toBeGreaterThan(0);
  }, 90_000);
});
