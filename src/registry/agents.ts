// Centralized Agent Registry (canonical source of truth).
//
// This is the single source of truth for active agents.
// During transition, it imports from existing src/agents/ modules.
// As domains are migrated, imports will shift to src/domains/<name>/runtime/agent.ts.

import type { AgentCapability, AgentExecutor } from '../executor/types.js';

import { capability as calendarCapability, executor as calendarExecutor } from '../domains/calendar/runtime/agent.js';
import { capability as schedulerCapability, executor as schedulerExecutor } from '../domains/scheduler/runtime/agent.js';
import { capability as emailCapability, executor as emailExecutor } from '../domains/email/runtime/agent.js';
import { capability as memoryCapability, executor as memoryExecutor } from '../domains/memory/runtime/agent.js';
import { capability as uiCapability, executor as uiExecutor } from '../domains/ui/runtime/agent.js';
import { capability as driveCapability, executor as driveExecutor } from '../domains/drive/runtime/agent.js';
import { capability as generalCapability, executor as generalExecutor } from '../agents/general/index.js';

export const AGENTS: Array<{ capability: AgentCapability; executor: AgentExecutor }> = [
  { capability: calendarCapability, executor: calendarExecutor },
  { capability: schedulerCapability, executor: schedulerExecutor },
  { capability: emailCapability, executor: emailExecutor },
  { capability: memoryCapability, executor: memoryExecutor },
  { capability: uiCapability, executor: uiExecutor },
  { capability: driveCapability, executor: driveExecutor },
  { capability: generalCapability, executor: generalExecutor },
];
