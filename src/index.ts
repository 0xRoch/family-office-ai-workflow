#!/usr/bin/env node

/**
 * Family Office AI Workflow - TypeScript Implementation
 * Main entry point for the TypeScript-based family office system
 */

export * from './types';
export * from './openbanking-fetcher';
export * from './analyze-orchestrator';
export * from './portfolio-orchestrator';

// Main entry point for standalone execution
if (require.main === module) {
  console.log('Family Office AI Workflow - TypeScript Implementation');
  console.log('Use individual scripts or workflow.sh for operations');
}