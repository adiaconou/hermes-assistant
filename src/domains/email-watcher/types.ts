/**
 * @fileoverview Email watcher type definitions.
 *
 * Shared types for email watcher service, classifier, and action execution.
 */

/** Email representation after fetch + normalization */
export type IncomingEmail = {
  messageId: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  attachments: EmailAttachment[];
};

export type EmailAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

/** Classifier output */
export type ClassificationResult = {
  emailIndex: number;
  email: IncomingEmail;
  matches: SkillMatch[];
};

export type SkillMatch = {
  skill: string;
  confidence: number;
  extracted: Record<string, string | number | null>;
  summary: string;
};

/** Notification throttle state */
export type ThrottleState = {
  count: number;
  windowStart: number;
};
