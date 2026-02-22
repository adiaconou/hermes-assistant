/**
 * @fileoverview Email watcher type definitions.
 *
 * Shared types for the email watcher service, classifier, and skill system.
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

/** Skill definition (matches DB schema) */
export type EmailSkill = {
  id: string;
  phoneNumber: string;
  name: string;
  description: string;
  matchCriteria: string;
  extractFields: string[];
  actionType: 'execute_with_tools' | 'notify';
  actionPrompt: string;
  tools: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
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

/** Skill validation */
export type SkillValidationError = {
  field: string;
  message: string;
};

/** Notification throttle state */
export type ThrottleState = {
  count: number;
  windowStart: number;
};
