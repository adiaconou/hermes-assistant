/**
 * @fileoverview Scheduled jobs type definitions.
 *
 * Defines types for recurring scheduled tasks that generate
 * and send LLM messages to users at specified times.
 */

/**
 * Message channel type.
 */
export type MessageChannel = 'sms' | 'whatsapp';

/**
 * A scheduled job stored in the database.
 */
export interface ScheduledJob {
  id: string;
  phoneNumber: string;
  channel: MessageChannel; // sms or whatsapp
  userRequest?: string; // Original user request (for display)
  prompt: string; // LLM-generated execution prompt
  cronExpression: string; // Standard cron format (or '@once' for one-time)
  timezone: string; // IANA timezone
  nextRunAt: number; // Unix timestamp (seconds)
  lastRunAt?: number; // Unix timestamp (seconds)
  enabled: boolean;
  isRecurring: boolean; // true for cron jobs, false for one-time reminders
  createdAt: number; // Unix timestamp (seconds)
  updatedAt: number; // Unix timestamp (seconds)
}

/**
 * Input for creating a new scheduled job.
 */
export interface CreateJobInput {
  phoneNumber: string;
  channel: MessageChannel;
  userRequest?: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: number;
  isRecurring: boolean;
}

/**
 * Fields that can be updated on an existing job.
 */
export interface JobUpdates {
  prompt?: string;
  userRequest?: string;
  cronExpression?: string;
  timezone?: string;
  nextRunAt?: number;
  lastRunAt?: number;
  enabled?: boolean;
}

/**
 * Result of job execution.
 */
export interface ExecutionResult {
  success: boolean;
  error?: Error;
}
