/**
 * @fileoverview Filesystem-skill email matcher.
 *
 * Matches incoming emails against loaded filesystem skills scoped to the
 * email channel. Conversational planning is not used in this background flow.
 */

import { listFilesystemSkills, matchSkillForMessage } from '../providers/skills.js';
import type { IncomingEmail, ClassificationResult, SkillMatch } from '../types.js';

function buildEmailMatchText(email: IncomingEmail): string {
  const attachmentNames = email.attachments.map((a) => a.filename).join(' ');
  return [
    email.from,
    email.subject,
    email.body,
    attachmentNames,
  ].filter(Boolean).join('\n');
}

/**
 * Match incoming emails against enabled filesystem skills for the email channel.
 */
export async function classifyEmails(
  _phoneNumber: string,
  emails: IncomingEmail[]
): Promise<ClassificationResult[]> {
  const skills = listFilesystemSkills()
    .filter((skill) => skill.enabled && skill.channels.includes('email'));

  if (skills.length === 0) return [];

  const results: ClassificationResult[] = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const match = matchSkillForMessage(buildEmailMatchText(email), 'email', skills);

    const matches: SkillMatch[] = match
      ? [{
          skill: match.skill.name,
          confidence: match.confidence,
          extracted: {},
          summary: match.rationale,
        }]
      : [];

    results.push({
      emailIndex: i + 1,
      email,
      matches,
    });
  }

  return results;
}
