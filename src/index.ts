#!/usr/bin/env node

/**
 * Family Office AI Workflow - TypeScript Implementation
 * Main entry point for the TypeScript-based family office system
 */

export * from './types.js';
export * from './openbanking-fetcher.js';
export * from './analyze-orchestrator.js';
export * from './portfolio-orchestrator.js';

// Main entry point for standalone execution
if (require.main === module) {
  console.log('Family Office AI Workflow - TypeScript Implementation');
  console.log('Use individual scripts or workflow.sh for operations');
}