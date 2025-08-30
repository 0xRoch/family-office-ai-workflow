#!/usr/bin/env node

/**
 * OpenBanking Fetcher Agent Implementation - TypeScript Version
 * Handles banking API integrations with intelligent change detection and ledger updates
 */

import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { format } from 'date-fns';
import * as dotenv from 'dotenv';
import {
  PositionChange,
  Position,
  PortfolioData,
  PortfolioPositions,
  LedgerEntry,
  Ledger,
  PowensConfig,
  PowensInvestmentData,
  CryptoPosition
} from './types';
import { SmartCryptoFetcher } from './crypto-fetcher';

interface CategorizationPatterns {
  real_estate: string[];
  funds: string[];
  private_equity: string[];
  private_debt: string[];
  crowdfunding: string[];
}

// Load environment variables
dotenv.config();

export class OpenBankingFetcher {
  private config: PowensConfig;
  private accessToken: string | null = null;
  private baseUrl: string;
  private categorizationPatterns: CategorizationPatterns | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.baseUrl = `https://${this.config.domain}/2.0`;
  }

  /**
   * Load categorization patterns from configuration file
   */
  private loadCategorizationPatterns(): CategorizationPatterns {
    if (this.categorizationPatterns) {
      return this.categorizationPatterns;
    }

    try {
      const configPath = path.join(process.cwd(), 'config', 'asset-patterns.json');
      const examplePath = path.join(process.cwd(), 'config', 'asset-patterns.example.json');

      let patternsFile = configPath;
      if (!fs.existsSync(configPath) && fs.existsSync(examplePath)) {
        patternsFile = examplePath;
      }

      const patterns = fs.readJsonSync(patternsFile);
      this.categorizationPatterns = patterns.categorization;
      return this.categorizationPatterns!;
    } catch (error) {
      console.error('❌ Failed to load categorization patterns, using fallback defaults:', error);

      // Fallback to generic patterns if config fails
      this.categorizationPatterns = {
        real_estate: ['reit', 'real estate', 'property'],
        funds: ['etf', 'index', 'fund'],
        private_equity: ['private', 'pe fund'],
        private_debt: ['bond', 'debt', 'credit'],
        crowdfunding: ['crowdfunding', 'crowd']
      };
      return this.categorizationPatterns;
    }
  }

  /**
   * Check if a position change is significant enough to log
   */
  private isSignificantChange(change: PositionChange): boolean {
    if (change.type === 'new' || change.type === 'closed') {
      return true;
    }

    const percentThreshold = parseFloat(process.env.SIGNIFICANCE_PERCENT_THRESHOLD || '5.0');
    const valueThreshold = parseFloat(process.env.SIGNIFICANCE_VALUE_EUR_THRESHOLD || '1000.0');

    if (change.percentChange && Math.abs(change.percentChange) >= percentThreshold) {
      return true;
    }

    if (change.oldValue && change.newValue) {
      const valueDiff = Math.abs(change.newValue - change.oldValue);
      return valueDiff >= valueThreshold;
    }

    return false;
  }

  /**
   * Load configuration from environment or config file
   */
  private loadConfig(): PowensConfig {
    const config = {
      domain: process.env.POWENS_DOMAIN || '',
      client_id: process.env.POWENS_CLIENT_ID || '',
      client_secret: process.env.POWENS_CLIENT_SECRET || '',
      user_id: process.env.POWENS_USER_ID || ''
    };

    // Validate required config
    const missing = Object.entries(config)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`Missing required config: ${missing.join(', ')}`);
    }

    return config;
  }

  /**
   * Authenticate with Powens API
   */
  async authenticate(): Promise<boolean> {
    try {
      const response: AxiosResponse = await axios.post(
        `${this.baseUrl}/auth/renew`,
        {
          client_id: this.config.client_id,
          client_secret: this.config.client_secret,
          id_user: parseInt(this.config.user_id)
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      if (response.status === 200) {
        this.accessToken = response.data.access_token;
        return Boolean(this.accessToken);
      } else {
        console.error(`Authentication failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error(`Authentication error: ${error}`);
      return false;
    }
  }

  /**
   * Fetch account data from API
   */
  async fetchAccounts(): Promise<any[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    try {
      const response: AxiosResponse = await axios.get(
        `${this.baseUrl}/users/${this.config.user_id}/accounts`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.status === 200) {
        return response.data.accounts || [];
      } else {
        console.error(`Failed to fetch accounts: ${response.status}`);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching accounts: ${error}`);
      return [];
    }
  }

  /**
   * Fetch investment data from API
   */
  async fetchInvestments(): Promise<PowensInvestmentData> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    try {
      const response: AxiosResponse = await axios.get(
        `${this.baseUrl}/users/${this.config.user_id}/investments`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.status === 200) {
        return response.data;
      } else {
        console.error(`Failed to fetch investments: ${response.status}`);
        return { investments: [], valuation: 0 };
      }
    } catch (error) {
      console.error(`Error fetching investments: ${error}`);
      return { investments: [], valuation: 0 };
    }
  }

  /**
   * Load previous positions data for comparison
   */
  async loadPreviousPositions(positionsFile: string): Promise<PortfolioData> {
    try {
      if (await fs.pathExists(positionsFile)) {
        const data = await fs.readJSON(positionsFile);
        return data;
      }
    } catch (error) {
      console.error(`Error loading previous positions: ${error}`);
    }

    return {
      totalNetWorth: 0,
      lastUpdated: '',
      accounts: [],
      positions: {
        equities: [],
        funds: [],
        private_equity: [],
        private_debt: [],
        real_estate: [],
        crowdfunding: [],
        bonds: [],
        cash: [],
        crypto: []
      }
    };
  }

  /**
   * Detect changes between old and new position data
   */
  detectChanges(oldData: PortfolioData, newData: PortfolioData): PositionChange[] {
    const changes: PositionChange[] = [];

    // Flatten old positions for easier comparison
    const oldPositions: Record<string, any> = {};
    const newPositions: Record<string, any> = {};

    const categories = ['equities', 'funds', 'private_equity', 'private_debt', 'real_estate', 'crowdfunding', 'crypto'];

    for (const category of categories) {
      const categoryKey = category as keyof PortfolioPositions;

      for (const pos of oldData.positions[categoryKey] || []) {
        const symbol = pos.symbol || (pos as any).isin || '';
        if (symbol) {
          oldPositions[symbol] = pos;
        }
      }

      for (const pos of newData.positions[categoryKey] || []) {
        const symbol = pos.symbol || (pos as any).isin || '';
        if (symbol) {
          newPositions[symbol] = pos;
        }
      }
    }

    // Find new positions
    for (const symbol of Object.keys(newPositions)) {
      if (!oldPositions[symbol]) {
        changes.push({
          type: 'new',
          symbol,
          newValue: newPositions[symbol].marketValue,
          newShares: newPositions[symbol].shares
        });
      }
    }

    // Find closed positions
    for (const symbol of Object.keys(oldPositions)) {
      if (!newPositions[symbol]) {
        changes.push({
          type: 'closed',
          symbol,
          oldValue: oldPositions[symbol].marketValue,
          oldShares: oldPositions[symbol].shares
        });
      }
    }

    // Find changed positions
    for (const symbol of Object.keys(oldPositions)) {
      if (newPositions[symbol]) {
        const oldPos = oldPositions[symbol];
        const newPos = newPositions[symbol];

        const oldValue = oldPos.marketValue || 0;
        const newValue = newPos.marketValue || 0;
        const oldShares = oldPos.shares || 0;
        const newShares = newPos.shares || 0;

        // Value change
        if (oldValue !== newValue && oldValue > 0) {
          const percentChange = ((newValue - oldValue) / oldValue) * 100;
          const change: PositionChange = {
            type: 'value_change',
            symbol,
            oldValue,
            newValue,
            percentChange
          };

          if (this.isSignificantChange(change)) {
            changes.push(change);
          }
        }

        // Share count change (indicates transaction)
        if (oldShares !== newShares) {
          changes.push({
            type: 'share_change',
            symbol,
            oldShares,
            newShares,
            oldValue,
            newValue
          });
        }
      }
    }

    return changes;
  }

  /**
   * Save a timestamped snapshot of positions
   */
  async savePositionSnapshot(positionsData: PortfolioData, historyDir: string): Promise<void> {
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const snapshotFile = path.join(historyDir, `positions_${timestamp}.json`);

    try {
      await fs.ensureDir(historyDir);
      await fs.writeJSON(snapshotFile, positionsData, { spaces: 2 });
      console.log(`Position snapshot saved: ${snapshotFile}`);
    } catch (error) {
      console.error(`Error saving snapshot: ${error}`);
    }
  }

  /**
   * Add entry to ledger.json with real data
   */
  async logToLedger(
    ledgerFile: string,
    entryType: string,
    status: string,
    details: any,
    runId?: string
  ): Promise<void> {
    if (!runId) {
      runId = `workflow-${format(new Date(), 'yyyy-MM-dd-HH-mm-ss')}`;
    }

    const newEntry: LedgerEntry = {
      id: runId,
      timestamp: new Date().toISOString(),
      duration: 0,
      phase: entryType,
      status,
      errors: [],
      summary: details.summary || {},
      notes: details.notes || ''
    };

    // Add specific fields for different entry types
    if (entryType === 'position_change') {
      Object.assign(newEntry, {
        symbol: details.symbol,
        change_type: details.change_type,
        value: details.value,
        shares: details.shares
      });
    } else if (entryType === 'data_collection') {
      // Ensure we have real summary data
      const summaryData = details.summary || {};
      newEntry.summary = {
        positionsAnalyzed: summaryData.positionsAnalyzed || 0,
        recommendationsGenerated: 0,
        totalPortfolioValue: summaryData.totalPortfolioValue || 0,
        changeFromLastRun: summaryData.changeFromLastRun || 0,
        newPositions: summaryData.newPositions || 0,
        closedPositions: summaryData.closedPositions || 0,
        significantMovements: summaryData.significantMovements || 0
      };
    }

    // Load existing ledger
    try {
      let ledger: Ledger;

      if (await fs.pathExists(ledgerFile)) {
        ledger = await fs.readJSON(ledgerFile);
      } else {
        ledger = { entries: [], schema: {} };
      }

      // Add new entry
      ledger.entries.push(newEntry);

      // Save updated ledger
      await fs.writeJSON(ledgerFile, ledger, { spaces: 2 });
    } catch (error) {
      console.error(`Error updating ledger: ${error}`);
    }
  }

  /**
   * Transform API data to internal positions.json format
   */
  transformToInternalFormat(accountsData: any[], investmentsData: PowensInvestmentData): PortfolioData {
    const timestamp = new Date().toISOString();
    const totalValuation = investmentsData.valuation || 0;

    // FIRST: Deduplicate accounts to get unique account IDs
    const uniqueAccounts: any[] = [];
    const seenAccounts = new Map<string, any>();
    const uniqueAccountIds = new Set<number>();

    for (const account of accountsData) {
      // Priority 1: Use IBAN if available (most reliable unique identifier)
      let accountKey = account.iban;

      // Priority 2: Use account number/webid if available
      if (!accountKey && (account.number || account.webid)) {
        accountKey = account.number || account.webid;
      }

      // Priority 3: Fallback to name+type combination (least reliable)
      if (!accountKey) {
        accountKey = `${account.original_name}-${account.id_type || account.type}`;
      }

      if (!seenAccounts.has(accountKey)) {
        uniqueAccounts.push(account);
        seenAccounts.set(accountKey, account);
        uniqueAccountIds.add(account.id); // Track unique account IDs
      } else {
        const existing = seenAccounts.get(accountKey);
        console.log(`⚠️  Skipping duplicate account: ${account.original_name} (€${account.balance}) - matches ${existing.original_name} via ${accountKey}`);
      }
    }

    console.log(`✓ Account deduplication: ${accountsData.length} → ${uniqueAccounts.length} accounts`);

    // Extract investments and categorize them (ONLY from unique accounts)
    const allInvestments: Position[] = [];

    for (const inv of investmentsData.investments || []) {
      // Skip investments from duplicate accounts
      if (!uniqueAccountIds.has(inv.id_account)) {
        continue;
      }

      if (inv.code_type === 'ISIN' &&
          inv.code !== 'XX-liquidity' &&
          (inv.valuation || 0) > 0) {

        allInvestments.push({
          symbol: inv.stock_symbol || inv.code,
          name: inv.label,
          shares: inv.quantity || 0,
          currentPrice: inv.unitvalue || 0,
          marketValue: inv.valuation || 0,
          costBasis: ((inv.quantity || 0) * (inv.unitprice || 0)),
          unrealizedGainLoss: inv.diff || 0,
          account: String(inv.id_account || ''),
          sector: 'Unknown',
          currency: 'EUR',
          isin: inv.code,
          lastUpdated: inv.vdate
        });
      }
    }

    // Remove exact duplicates first
    const uniqueInvestments: Position[] = [];
    const seenCombinations = new Set<string>();

    for (const inv of allInvestments) {
      const signature = `${inv.symbol}-${inv.shares}-${inv.marketValue}-${inv.currentPrice}`;
      if (!seenCombinations.has(signature)) {
        uniqueInvestments.push(inv);
        seenCombinations.add(signature);
      } else {
        console.log(`⚠️  Skipping exact duplicate: ${inv.symbol} in account ${inv.account}`);
      }
    }

    // Consolidate remaining positions by symbol
    const consolidatedPositions: Record<string, Position> = {};

    for (const inv of uniqueInvestments) {
      const symbol = inv.symbol;

      if (consolidatedPositions[symbol]) {
        // Consolidate: sum shares and market values for truly different positions
        const existing = consolidatedPositions[symbol];
        const totalShares = existing.shares + inv.shares;
        const totalMarketValue = existing.marketValue + inv.marketValue;
        const totalCostBasis = existing.costBasis + inv.costBasis;

        consolidatedPositions[symbol] = {
          ...existing,
          shares: totalShares,
          marketValue: totalMarketValue,
          costBasis: totalCostBasis,
          currentPrice: totalShares > 0 ? totalMarketValue / totalShares : 0,
          unrealizedGainLoss: totalMarketValue - totalCostBasis,
          account: `${existing.account},${inv.account}`
        };
      } else {
        consolidatedPositions[symbol] = inv;
      }
    }

    // Simple categorization logic
    const categories: PortfolioPositions = {
      equities: [],
      funds: [],
      private_equity: [],
      private_debt: [],
      real_estate: [],
      crowdfunding: [],
      bonds: [],
      cash: [],
      crypto: []
    };

    const patterns = this.loadCategorizationPatterns();

    for (const inv of Object.values(consolidatedPositions)) {
      const nameLower = (inv.name || '').toLowerCase();
      const isin = (inv.isin || '').toUpperCase();

      if (patterns.real_estate.some(term => nameLower.includes(term))) {
        categories.real_estate.push(inv);
      } else if (patterns.funds.some(term => nameLower.includes(term))) {
        categories.funds.push(inv);
      } else if (patterns.private_equity.some(term => nameLower.includes(term))) {
        categories.private_equity.push(inv);
      } else if (patterns.private_debt.some(term => nameLower.includes(term))) {
        categories.private_debt.push(inv);
      } else if (patterns.crowdfunding.some(term => nameLower.includes(term))) {
        categories.crowdfunding.push(inv);
      } else if (isin.startsWith('FR0000')) {
        categories.equities.push(inv);
      } else {
        categories.equities.push(inv); // Default to equities
      }
    }

    // Use already deduplicated accounts from earlier in this function

    // Calculate corrected total net worth using deduplicated accounts
    const accountsTotal = uniqueAccounts.reduce((sum, account) => sum + (account.balance || 0), 0);
    const correctedTotal = accountsTotal; // investmentsData.valuation already includes investments

    return {
      lastUpdated: timestamp,
      totalNetWorth: correctedTotal,
      accounts: uniqueAccounts,
      positions: categories
    };
  }

  /**
   * Main method to fetch data, detect changes, and update files
   */
  async fetchAndUpdate(
    positionsFile: string,
    ledgerFile: string,
    historyDir?: string
  ): Promise<boolean> {
    console.log('OpenBanking Fetcher: Starting data collection...');

    // Load previous positions for comparison
    const previousData = await this.loadPreviousPositions(positionsFile);
    const previousTotal = previousData.totalNetWorth || 0;

    // Authenticate with API
    if (!(await this.authenticate())) {
      await this.logToLedger(ledgerFile, 'data_collection', 'failed', {
        notes: 'Authentication failed with banking provider'
      });
      return false;
    }

    console.log('✓ Authentication successful');

    // Fetch fresh data
    const accounts = await this.fetchAccounts();
    const investments = await this.fetchInvestments();

    if (!investments || !investments.investments || investments.investments.length === 0) {
      await this.logToLedger(ledgerFile, 'data_collection', 'failed', {
        notes: 'No investment data received from API'
      });
      return false;
    }

    console.log(`✓ Fetched ${accounts.length} accounts and ${investments.investments.length} investments`);

    // Transform to internal format
    const newData = this.transformToInternalFormat(accounts, investments);

    // Fetch crypto positions if configured
    if (SmartCryptoFetcher.isCryptoConfigured()) {
      console.log('🔗 Smart fetching crypto positions...');
      try {
        const cryptoFetcher = new SmartCryptoFetcher();
        const cryptoPositions = await cryptoFetcher.fetchAllPositions();

        // Convert crypto positions to match our Position interface for consistency
        const convertedCryptoPositions = cryptoPositions.map(crypto => ({
          symbol: crypto.symbol,
          name: crypto.name,
          shares: crypto.balance,
          currentPrice: crypto.currentPrice,
          marketValue: crypto.marketValue,
          costBasis: crypto.marketValue, // No cost basis data for crypto yet
          unrealizedGainLoss: 0, // No cost basis to calculate against
          account: `${crypto.chain}-${crypto.wallet.slice(0, 6)}...${crypto.wallet.slice(-4)}`,
          sector: crypto.protocol || 'Cryptocurrency',
          currency: 'USD',
          lastUpdated: crypto.lastUpdated,
          // Crypto-specific fields preserved
          balance: crypto.balance,
          chain: crypto.chain,
          wallet: crypto.wallet,
          contractAddress: crypto.contractAddress,
          protocol: crypto.protocol,
          type: crypto.type,
          apy: crypto.apy
        } as any));

        newData.positions.crypto = convertedCryptoPositions;
        newData.totalNetWorth += cryptoPositions.reduce((sum, pos) => sum + pos.marketValue, 0);

        console.log(`✓ Added ${cryptoPositions.length} crypto positions (€${cryptoPositions.reduce((sum, pos) => sum + pos.marketValue, 0).toFixed(2)})`);
      } catch (error) {
        console.error('✗ Failed to fetch crypto positions:', error);
        // Continue without crypto data
      }
    } else {
      console.log('📝 No crypto wallets configured, skipping crypto data collection');
    }

    const newTotal = newData.totalNetWorth || 0;

    // Detect changes
    const changes = this.detectChanges(previousData, newData);
    const significantChanges = changes.filter(c => this.isSignificantChange(c));

    console.log(`✓ Detected ${changes.length} changes, ${significantChanges.length} significant`);

    // Log specific changes to ledger
    const runId = `fetch-${format(new Date(), 'yyyy-MM-dd-HH-mm-ss')}`;

    for (const change of significantChanges) {
      if (change.type === 'new') {
        await this.logToLedger(ledgerFile, 'position_change', 'opened', {
          symbol: change.symbol,
          change_type: 'new_position',
          value: change.newValue,
          shares: change.newShares,
          notes: `New position opened: ${change.symbol}`
        }, `${runId}-${change.symbol}`);
      } else if (change.type === 'closed') {
        await this.logToLedger(ledgerFile, 'position_change', 'closed', {
          symbol: change.symbol,
          change_type: 'closed_position',
          value: change.oldValue,
          shares: change.oldShares,
          notes: `Position closed: ${change.symbol}`
        }, `${runId}-${change.symbol}`);
      } else if (change.type === 'value_change') {
        await this.logToLedger(ledgerFile, 'price_update', 'significant', {
          symbol: change.symbol,
          change_type: 'value_change',
          value: change.newValue,
          notes: `${change.symbol}: ${change.percentChange ? change.percentChange.toFixed(1) : '0'}% change`
        }, `${runId}-${change.symbol}`);
      }
    }

    // Count positions by category
    const totalPositions = Object.values(newData.positions).reduce((sum, positions) => sum + positions.length, 0);

    // Log overall fetch summary with REAL data
    await this.logToLedger(ledgerFile, 'data_collection', 'completed', {
      summary: {
        positionsAnalyzed: totalPositions,
        totalPortfolioValue: newTotal,
        changeFromLastRun: newTotal - previousTotal,
        newPositions: changes.filter(c => c.type === 'new').length,
        closedPositions: changes.filter(c => c.type === 'closed').length,
        significantMovements: significantChanges.length
      },
      notes: `Fetched ${totalPositions} positions, portfolio value: €${newTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    }, runId);

    // Save updated positions file
    await fs.writeJSON(positionsFile, newData, { spaces: 2 });
    console.log(`✓ Updated positions file: ${positionsFile}`);

    // Save position snapshot if history directory provided
    if (historyDir) {
      await this.savePositionSnapshot(newData, historyDir);
    }

    console.log('✓ OpenBanking fetch completed successfully');
    return true;
  }
}

/**
 * CLI interface for the OpenBanking fetcher
 */
async function main(): Promise<void> {
  if (process.argv.length < 3) {
    console.log('Usage: openbanking-fetcher <action> [options]');
    console.log('Actions: fetch, status, test_connection');
    process.exit(1);
  }

  const action = process.argv[2];

  // Default paths
  const positionsFile = 'data/positions.json';
  const ledgerFile = 'data/ledger.json';
  const historyDir = 'data/positions_history';

  try {
    const fetcher = new OpenBankingFetcher();

    switch (action) {
      case 'fetch':
        const success = await fetcher.fetchAndUpdate(positionsFile, ledgerFile, historyDir);
        process.exit(success ? 0 : 1);

      case 'test_connection':
        if (await fetcher.authenticate()) {
          console.log('✓ Connection test successful');
          process.exit(0);
        } else {
          console.log('✗ Connection test failed');
          process.exit(1);
        }

      case 'status':
        // Show current status without fetching
        if (await fs.pathExists(positionsFile)) {
          const data = await fs.readJSON(positionsFile);
          console.log(`Last updated: ${data.lastUpdated || 'Unknown'}`);
          console.log(`Total value: €${(data.totalNetWorth || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
          const positions = data.positions || {};
          const totalPositions = Object.values(positions).reduce((sum: number, positionArray: any) => {
            return sum + (Array.isArray(positionArray) ? positionArray.length : 0);
          }, 0);
          console.log(`Total positions: ${totalPositions}`);
        } else {
          console.log('No positions data found');
        }
        process.exit(0);

      default:
        console.log(`Unknown action: ${action}`);
        process.exit(1);
    }
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