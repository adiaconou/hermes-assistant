/**
 * Agents Module
 *
 * Concrete agent implementations. Each agent exports a capability and executor.
 */

export type {
  StepResult,
  AgentCapability,
  AgentRegistry,
  AgentExecutionContext,
  AgentExecutor,
} from '../executor/types.js';

export { executeWithTools, formatPreviousResults } from '../executor/tool-executor.js';

export {
  capability as calendarAgentCapability,
  executor as executeCalendarAgent,
} from './calendar/index.js';

export {
  capability as schedulerAgentCapability,
  executor as executeSchedulerAgent,
} from './scheduler/index.js';

export {
  capability as emailAgentCapability,
  executor as executeEmailAgent,
} from './email/index.js';

export {
  capability as memoryAgentCapability,
  executor as executeMemoryAgent,
} from './memory/index.js';

export {
  capability as uiAgentCapability,
  executor as executeUiAgent,
} from './ui/index.js';

export {
  capability as generalAgentCapability,
  executor as executeGeneralAgent,
} from './general/index.js';

import type { AgentCapability, AgentExecutor } from '../executor/types.js';
import { capability as calendarCapability, executor as calendarExecutor } from './calendar/index.js';
import { capability as schedulerCapability, executor as schedulerExecutor } from './scheduler/index.js';
import { capability as emailCapability, executor as emailExecutor } from './email/index.js';
import { capability as memoryCapability, executor as memoryExecutor } from './memory/index.js';
import { capability as uiCapability, executor as uiExecutor } from './ui/index.js';
import { capability as generalCapability, executor as generalExecutor } from './general/index.js';

export const AGENTS: Array<{ capability: AgentCapability; executor: AgentExecutor }> = [
  { capability: calendarCapability, executor: calendarExecutor },
  { capability: schedulerCapability, executor: schedulerExecutor },
  { capability: emailCapability, executor: emailExecutor },
  { capability: memoryCapability, executor: memoryExecutor },
  { capability: uiCapability, executor: uiExecutor },
  { capability: generalCapability, executor: generalExecutor },
];
