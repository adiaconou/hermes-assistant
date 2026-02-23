/**
 * E2E Test Report Writer
 *
 * Writes markdown reports to tests/e2e/output/ after each test scenario,
 * capturing the full conversation transcript and optional LLM judge verdict.
 * Generated pages are saved as standalone HTML files alongside the report.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { E2EResponse } from './harness.js';
import type { JudgeVerdict } from './judge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

/** Convert a WSL absolute path to a Chrome-pasteable address. */
function toChromeAddress(wslPath: string): string {
  const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu';
  return `\\\\wsl$\\${distro}${wslPath.replace(/\//g, '\\')}`;
}

export interface TestReportTurn {
  userMessage: string;
  response: E2EResponse;
}

export interface TestReport {
  testName: string;
  turns: TestReportTurn[];
  /** Map of short URLs to HTML content (from harness.getGeneratedPages()) */
  generatedPages?: Map<string, string>;
  verdict?: JudgeVerdict;
}

/**
 * Write a markdown report for an e2e test run.
 * Creates the output directory lazily. Returns the written file path.
 *
 * Generated pages are saved as separate HTML files in the same directory
 * and linked from the report so they can be opened directly in a browser.
 */
export function writeTestReport(report: TestReport): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = report.testName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeName}_${timestamp}.md`;
  const filePath = path.join(OUTPUT_DIR, filename);

  const lines: string[] = [];

  // Header
  lines.push(`# E2E Test Report: ${report.testName}`);
  lines.push(`**Date**: ${new Date().toISOString()}`);
  lines.push('');

  // Conversation transcript
  lines.push('## Conversation Transcript');
  lines.push('');

  for (let i = 0; i < report.turns.length; i++) {
    const turn = report.turns[i];
    lines.push(`### Turn ${i + 1}`);
    lines.push(`**[USER]**: ${turn.userMessage}`);
    if (turn.response.syncResponse) {
      lines.push(`**[ASSISTANT sync]**: ${turn.response.syncResponse}`);
    } else {
      lines.push(`**[ASSISTANT sync]**: _(empty TwiML — WhatsApp typing indicator shown)_`);
    }
    if (turn.response.asyncResponse) {
      lines.push(`**[ASSISTANT async]**: ${turn.response.asyncResponse}`);
    }
    lines.push('');
  }

  // Generated pages — save as HTML files and link from the report
  if (report.generatedPages && report.generatedPages.size > 0) {
    lines.push('## Generated Pages');
    lines.push('');

    let pageNum = 0;
    for (const [shortUrl, html] of report.generatedPages) {
      pageNum++;
      const pageFilename = `${safeName}_${timestamp}_page${pageNum}.html`;
      const pageFilePath = path.join(OUTPUT_DIR, pageFilename);
      fs.writeFileSync(pageFilePath, html, 'utf-8');
      lines.push(`- **${shortUrl}**: \`${toChromeAddress(pageFilePath)}\``);
    }
    lines.push('');
  }

  // Judge verdict (if present)
  if (report.verdict) {
    lines.push('## LLM Judge Verdict');
    lines.push(`**Overall**: ${report.verdict.overall}`);
    lines.push('');
    lines.push('| # | Criterion | Verdict | Reason |');
    lines.push('|---|-----------|---------|--------|');
    for (let i = 0; i < report.verdict.criteria.length; i++) {
      const c = report.verdict.criteria[i];
      lines.push(`| ${i + 1} | ${c.criterion} | ${c.verdict} | ${c.reason} |`);
    }
    lines.push('');
    lines.push(`**Summary**: ${report.verdict.summary}`);
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}
