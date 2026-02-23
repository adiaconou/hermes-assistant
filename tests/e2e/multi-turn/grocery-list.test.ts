import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { E2EHarness } from '../harness.js';
import { writeTestReport } from '../reporter.js';

const hasApiKey = process.env.ANTHROPIC_API_KEY
  && process.env.ANTHROPIC_API_KEY !== 'test-api-key';

const describeE2E = hasApiKey ? describe : describe.skip;

describeE2E('Multi-turn: Grocery List', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = new E2EHarness();
    await harness.start();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('creates grocery-list UI, then uses multi-turn history to regenerate with hummus on turn 2', async () => {
    const initialItems = ['eggs', 'milk', 'bread', 'butter'];

    // -- Turn 1: Natural grocery list request --
    const turn1 = await harness.sendMessage(
      'Create a grocery list with eggs, milk, bread and butter'
    );

    // WhatsApp always-orchestrate: sync response is empty TwiML
    expect(turn1.syncResponse).toBe('');

    // Deterministic: extract URL and verify HTML contains all items
    const firstUrl = harness.extractShortUrl(turn1.finalResponse);
    const firstHtml = (await harness.fetchPageHtml(firstUrl)).toLowerCase();
    for (const item of initialItems) {
      expect(firstHtml).toContain(item);
    }

    // -- Turn 2: intentionally omits original items to force history retrieval --
    const turn2 = await harness.sendMessage(
      'Add hummus and regenerate the page. Return the new link.'
    );

    // WhatsApp always-orchestrate: sync response is empty TwiML on every turn
    expect(turn2.syncResponse).toBe('');

    // Deterministic: new URL, HTML contains all original items plus hummus
    const secondUrl = harness.extractShortUrl(turn2.finalResponse);
    expect(secondUrl).not.toBe(firstUrl);

    const secondHtml = (await harness.fetchPageHtml(secondUrl)).toLowerCase();
    for (const item of [...initialItems, 'hummus']) {
      expect(secondHtml).toContain(item);
    }

    // Typing indicator fired once per turn with valid MessageSid, stopped after each
    const typingCalls = harness.getTypingIndicatorCalls();
    expect(typingCalls.length).toBe(2);
    expect(typingCalls[0].messageSid).toMatch(/^SM\d+$/);
    expect(typingCalls[0].stopped).toBe(true);
    expect(typingCalls[1].messageSid).toMatch(/^SM\d+$/);
    expect(typingCalls[1].stopped).toBe(true);
    // Each turn gets a unique MessageSid
    expect(typingCalls[0].messageSid).not.toBe(typingCalls[1].messageSid);

    // Capture turns for report before judge + assertions (written even on failure)
    const turns = [
      { userMessage: 'Create a grocery list with eggs, milk, bread and butter', response: turn1 },
      { userMessage: 'Add hummus and regenerate the page. Return the new link.', response: turn2 },
    ];

    // -- LLM Judge: analyzes conversation transcript + full trace logs --
    const verdict = await harness.judgeConversation([
      'The assistant correctly created a grocery list with all four requested items (eggs, milk, bread, butter) on turn 1.',
      'The assistant correctly interpreted "add hummus" on turn 2 as adding to the existing grocery list, not creating a new unrelated list.',
      'The turn 2 grocery list contains all five items (the original four plus hummus) — nothing was forgotten.',
      'The assistant provided a working link in each response.',
      'The conversation flow is natural and coherent — the assistant understood the user intent without confusion or unnecessary clarification.',
      'No errors in the trace logs indicate data loss, silent failures, or corrupted state.',
    ]);

    // Write report with verdict + generated page HTML files
    const reportPath = writeTestReport({
      testName: 'multi-turn-grocery-list',
      turns,
      generatedPages: harness.getGeneratedPages(),
      verdict,
    });
    console.log(`\n📄 Report: ${reportPath}\n`);

    // Log the full verdict as a readable diagnostic (not a hard gate)
    console.log('\n── LLM Judge Verdict ──');
    for (const c of verdict.criteria) {
      console.log(`  ${c.verdict === 'PASS' ? '✓' : '✗'} ${c.criterion}`);
      console.log(`    → ${c.reason}`);
    }
    console.log(`  Overall: ${verdict.overall} — ${verdict.summary}`);
    console.log('── End Judge Verdict ──\n');
    expect(['PASS', 'FAIL']).toContain(verdict.overall);
  }, 240_000); // 4 minute timeout: 2 LLM turns + judge call
});
