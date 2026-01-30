/**
 * Orchestrator Module
 *
 * Plans, delegates, tracks, and dynamically adjusts execution
 * of complex user requests across specialized agents.
 */

// Export types
export * from './types.js';

// Export executor scaffolding
export {
  createAgentRegistry,
  registerAgent,
  getAgentNames,
  formatAgentsForPrompt,
} from '../executor/registry.js';

export {
  routeToAgent,
  registerAgentExecutor,
  getRegisteredAgentNames,
} from '../executor/router.js';

export {
  executeWithTools,
  formatPreviousResults,
} from '../executor/tool-executor.js';

// Export agent capabilities and executors (backwards compatibility)
export {
  generalAgentCapability,
  executeGeneralAgent,
  calendarAgentCapability,
  executeCalendarAgent,
  schedulerAgentCapability,
  executeSchedulerAgent,
  emailAgentCapability,
  executeEmailAgent,
  memoryAgentCapability,
  executeMemoryAgent,
  uiAgentCapability,
  executeUiAgent,
} from '../agents/index.js';

// Export conversation window
export {
  getRelevantHistory,
  formatHistoryForPrompt,
  getWindowStats,
} from './conversation-window.js';

// Export planner
export {
  createPlan,
  resolveTaskDates,
} from './planner.js';

// Export executor
export {
  executeStep,
  shouldReplan,
  formatStepResult,
} from './executor.js';

// Export replanner
export {
  replan,
  canReplan,
} from './replanner.js';

// Export main orchestrate function
export { orchestrate } from './orchestrate.js';

// Export response composer
export { synthesizeResponse } from './response-composer.js';

// Export handler (integration layer)
export { handleWithOrchestrator } from './handler.js';
