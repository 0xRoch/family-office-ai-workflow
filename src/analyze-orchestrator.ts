#!/usr/bin/env node

/**
 * Dynamic Parallel Analysis Orchestrator for Family Office Workflow - TypeScript Version
 *
 * This script dynamically discovers analysis requests and generates instructions
 * for Claude Code to process them in parallel batches.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as glob from 'glob';
import { AnalysisRequest, PositionDetails } from './types';

interface AssetPatterns {
  crypto: { symbols: string[]; names: string[] };
  private_equity: { symbols: string[]; names: string[] };
  real_estate: { symbols: string[]; names: string[] };
  funds: { symbols: string[]; names: string[] };
  alternative_credit: { symbols: string[]; names: string[] };
}

export class AnalysisOrchestrator {
  private assetPatterns: AssetPatterns | null = null;

  /**
   * Load asset patterns from configuration file
   */
  private loadAssetPatterns(): AssetPatterns {
    if (this.assetPatterns) {
      return this.assetPatterns;
    }

    try {
      const configPath = path.join(process.cwd(), 'config', 'asset-patterns.json');
      const examplePath = path.join(process.cwd(), 'config', 'asset-patterns.example.json');

      let patternsFile = configPath;
      if (!fs.existsSync(configPath) && fs.existsSync(examplePath)) {
        console.log('⚠️  Using example asset patterns. Copy asset-patterns.example.json to asset-patterns.json and customize.');
        patternsFile = examplePath;
      }

      this.assetPatterns = fs.readJsonSync(patternsFile);
      return this.assetPatterns!;
    } catch (error) {
      console.error('❌ Failed to load asset patterns, using fallback defaults:', error);

      // Fallback to original hardcoded patterns if config fails
      this.assetPatterns = {
        crypto: {
          symbols: ['ETH', 'BTC', 'USDC', 'USDT', 'DAI', 'WBTC', 'WETH', 'MATIC', 'POLYGON'],
          names: ['ETHEREUM', 'BITCOIN', 'CRYPTO', 'TOKEN', 'COIN', 'DEFI', 'STAKING', 'LIQUIDITY POOL']
        },
        private_equity: {
          symbols: [],
          names: ['PRIVATE', 'PE FUND']
        },
        real_estate: {
          symbols: [],
          names: ['REIT', 'REAL ESTATE']
        },
        funds: {
          symbols: [],
          names: ['ETF', 'UCITS', 'INDEX', 'TRACKER', 'FUND']
        },
        alternative_credit: {
          symbols: [],
          names: ['CORPORATE BOND', 'PRIVATE DEBT']
        }
      };
      return this.assetPatterns;
    }
  }

  /**
   * Dynamically discover all analysis requests
   */
  async discoverPositions(requestDir: string): Promise<string[]> {
    if (!(await fs.pathExists(requestDir))) {
      console.log(`❌ Request directory not found: ${requestDir}`);
      return [];
    }

    const pattern = path.join(requestDir, 'analyze_*.json');
    const positions = glob.sync(pattern);
    positions.sort(); // Consistent ordering

    return positions;
  }

  /**
   * Determine the appropriate agent type based on position data
   */
  determineAgentType(positionData: AnalysisRequest): string {
    const name = (positionData.name || '').toUpperCase();
    const symbol = (positionData.symbol || '').toUpperCase();
    const patterns = this.loadAssetPatterns();

    // Crypto patterns (check first - most specific)
    if (patterns.crypto.symbols.some(pattern => symbol.includes(pattern)) ||
        patterns.crypto.names.some(pattern => name.includes(pattern))) {
      return 'crypto-analyst';
    }

    // Private Equity patterns (check first - most specific)
    if (patterns.private_equity.symbols.some(pattern => symbol.includes(pattern)) ||
        patterns.private_equity.names.some(pattern => name.includes(pattern))) {
      return 'private-equity-analyst';
    }

    // Real Estate patterns (check before private debt to catch Pierre/Immo)
    if (patterns.real_estate.symbols.some(pattern => symbol.includes(pattern)) ||
        patterns.real_estate.names.some(pattern => name.includes(pattern))) {
      return 'real-estate-analyst';
    }

    // Funds patterns (ETFs and managed funds)
    if (patterns.funds.symbols.some(pattern => symbol.includes(pattern)) ||
        patterns.funds.names.some(pattern => name.includes(pattern))) {
      return 'fund-analyst';
    }

    // Private Debt patterns (check after other categories to avoid false positives)
    if (patterns.alternative_credit.symbols.some(pattern => symbol.includes(pattern)) ||
        patterns.alternative_credit.names.some(pattern => name.includes(pattern))) {
      return 'alternative-credit-analyst';
    }

    // Default to equity analyst for individual stocks (including banks like CREDIT AGRICOLE)
    return 'equity-research-analyst';
  }

  /**
   * Load position details from JSON request file
   */
  async loadPositionDetails(jsonFile: string): Promise<PositionDetails> {
    try {
      const data = await fs.readJSON(jsonFile) as AnalysisRequest;
      const agentType = this.determineAgentType(data);

      return {
        symbol: data.symbol || 'UNKNOWN',
        name: data.name || 'Unknown Company',
        market_value: data.marketValue || 0,
        agent_type: agentType,
        file: jsonFile
      };
    } catch (error) {
      console.log(`⚠️  Error reading ${jsonFile}: ${error}`);
      return {
        symbol: 'ERROR',
        name: 'Error loading position',
        market_value: 0,
        agent_type: 'equity-research-analyst',
        file: jsonFile
      };
    }
  }

  /**
   * Generate instructions for Claude Code to execute parallel analysis
   */
  async generateParallelInstructions(
    positions: string[],
    batchSize: number,
    reportDir: string
  ): Promise<void> {
    const totalCount = positions.length;

    if (totalCount === 0) {
      console.log('❌ No positions found to analyze');
      return;
    }

    const numBatches = Math.ceil(totalCount / batchSize);

    console.log('\n🎯 PARALLEL ANALYSIS ORCHESTRATOR');
    console.log('═══════════════════════════════════');
    console.log(`Total positions: ${totalCount}`);
    console.log(`Batch size: ${batchSize}`);
    console.log(`Number of batches: ${numBatches}`);
    console.log(`Reports directory: ${reportDir}`);
    console.log();

    for (let batchNum = 0; batchNum < numBatches; batchNum++) {
      const startIdx = batchNum * batchSize;
      const endIdx = Math.min(startIdx + batchSize, totalCount);
      const batchPositions = positions.slice(startIdx, endIdx);

      console.log(`📊 BATCH ${batchNum + 1}/${numBatches}`);
      console.log('────────────────────────────────────');
      console.log('Positions to analyze in parallel:');

      const positionDetails: PositionDetails[] = [];
      for (const posFile of batchPositions) {
        const details = await this.loadPositionDetails(posFile);
        positionDetails.push(details);
        const marketValueStr = details.market_value ? `€${details.market_value.toLocaleString()}` : 'N/A';
        console.log(`  • ${details.symbol} - ${details.name} (${marketValueStr}) [${details.agent_type}]`);
      }

      console.log();
      console.log('💡 Claude Code Instructions:');
      console.log('   Execute these Task tool calls simultaneously in one response:');
      console.log();

      for (let i = 0; i < positionDetails.length; i++) {
        const details = positionDetails[i];
        console.log(`   Task ${i + 1}: ${details.agent_type}`);
        console.log(`   - Symbol: ${details.symbol}`);
        console.log(`   - Request: Analyze ${details.name} position using ${details.agent_type}`);
        console.log(`   - Data: ${path.basename(details.file)}`);
        console.log(`   - Report: ${reportDir}/${details.symbol}.md`);
        console.log();
      }

      console.log(`⏩ Execute these ${positionDetails.length} agents SEQUENTIALLY (one at a time, NOT in parallel)`);
      console.log('   Wait for each agent to complete before starting the next.');
      console.log('   Add a 10-second delay between each agent to avoid rate limits.\n');

      if (batchNum < numBatches - 1) {
        console.log('─'.repeat(50));
        console.log();
      }
    }
  }

  /**
   * Main orchestrator function
   */
  async orchestrate(requestDir: string, reportDir: string = 'reports', batchSize: number = 1): Promise<void> {
    // Discover all positions dynamically
    const positions = await this.discoverPositions(requestDir);

    if (positions.length === 0) {
      console.log('❌ No analysis requests found');
      process.exit(1);
    }

    // Generate parallel execution instructions
    await this.generateParallelInstructions(positions, batchSize, reportDir);

    console.log('✅ Orchestrator complete');
    console.log('📋 Next steps:');
    console.log('   1. Copy the Task tool calls above');
    console.log('   2. Execute them in Claude Code SEQUENTIALLY (one at a time)');
    console.log(`   3. Process 1 position at a time with 10s delay between each`);
    console.log(`   4. Reports will be saved to ${reportDir}/[SYMBOL].md`);
  }
}

/**
 * CLI interface for the Analysis Orchestrator
 */
async function main(): Promise<void> {
  if (process.argv.length < 3) {
    console.log('Usage: analyze-orchestrator <request_directory> [report_directory] [batch_size]');
    process.exit(1);
  }

  const requestDir = process.argv[2];
  const reportDir = process.argv[3] || 'reports';
  const batchSize = process.argv[4] ? parseInt(process.argv[4]) : parseInt(process.env.BATCH_SIZE || '5');

  const orchestrator = new AnalysisOrchestrator();

  try {
    await orchestrator.orchestrate(requestDir, reportDir, batchSize);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}