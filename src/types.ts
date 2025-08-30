/**
 * Common types and interfaces for the Family Office AI Workflow
 */

export interface PositionChange {
  type: 'new' | 'closed' | 'value_change' | 'share_change';
  symbol: string;
  oldValue?: number;
  newValue?: number;
  oldShares?: number;
  newShares?: number;
  percentChange?: number;
}

export interface Position {
  symbol: string;
  name: string;
  shares: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedGainLoss: number;
  account: string;
  sector: string;
  currency: string;
  isin?: string;
  lastUpdated?: string;
}

export interface PortfolioPositions {
  equities: Position[];
  funds: Position[];
  bonds: Position[];
  cash: Position[];
  private_equity: Position[];
  private_debt: Position[];
  real_estate: Position[];
  crowdfunding: Position[];
  crypto: CryptoPosition[];
}

export interface PortfolioData {
  lastUpdated: string;
  totalNetWorth: number;
  accounts: any[];
  positions: PortfolioPositions;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  duration: number;
  phase: string;
  status: string;
  errors: string[];
  summary: {
    positionsAnalyzed?: number;
    recommendationsGenerated?: number;
    totalPortfolioValue?: number;
    changeFromLastRun?: number;
    newPositions?: number;
    closedPositions?: number;
    significantMovements?: number;
  };
  notes: string;
  symbol?: string;
  change_type?: string;
  value?: number;
  shares?: number;
}

export interface Ledger {
  entries: LedgerEntry[];
  schema: Record<string, any>;
}

export interface PowensConfig {
  domain: string;
  client_id: string;
  client_secret: string;
  user_id: string;
}

export interface PowensInvestment {
  code_type: string;
  code: string;
  stock_symbol?: string;
  label: string;
  quantity: number;
  unitvalue: number;
  valuation: number;
  unitprice: number;
  diff: number;
  id_account: number;
  vdate: string;
}

export interface PowensInvestmentData {
  investments: PowensInvestment[];
  valuation: number;
}

export interface PowensAccountData {
  accounts: any[];
  balance?: number;
}

export interface AnalysisRequest {
  symbol: string;
  name: string;
  marketValue: number;
  shares: number;
  currentPrice: number;
  costBasis: number;
  unrealizedGainLoss: number;
  analysisRequest: string;
}

export interface PositionDetails {
  symbol: string;
  name: string;
  market_value: number;
  agent_type: string;
  file: string;
}

export interface OptimizationRequest {
  task: string;
  data_sources: {
    positions: string;
    reports_directory: string;
    output_report: string;
  };
  optimization_rules: {
    anti_overtrading_threshold: number;
    max_position_size: number;
    min_position_size: number;
    target_cash_reserve: number;
    rebalancing_frequency: string;
  };
  family_office_principles: string[];
}

export interface Recommendations {
  buy: string[];
  hold: string[];
  sell: string[];
  target_prices: Record<string, {
    price: number;
    upside?: number;
  }>;
  specific_actions: string[];
}

// Crypto-specific interfaces
export interface CryptoPosition {
  symbol: string;
  name: string;
  balance: number;
  currentPrice: number;
  marketValue: number;
  contractAddress?: string | undefined;
  chain: string;
  wallet: string;
  protocol?: string | undefined;
  type: 'token' | 'lp' | 'staking' | 'lending' | 'borrowing';
  apy?: number | undefined;
  lastUpdated: string;
}

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface WalletData {
  address: string;
  chain: string;
  tokens: TokenBalance[];
  defiPositions: DeFiPosition[];
  totalValue: number;
}

export interface TokenBalance {
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  contractAddress?: string;
  priceUsd: number;
  valueUsd: number;
}

export interface DeFiPosition {
  protocol: string;
  type: 'lending' | 'borrowing' | 'liquidity_pool' | 'staking' | 'farming';
  tokens: TokenBalance[];
  totalValue: number;
  apy?: number;
  health?: number; // For borrowing positions
  rewards?: TokenBalance[];
}

export interface CryptoConfig {
  wallets: string[];
  chains: ChainConfig[];
  minPositionValue: number;
}

export interface CryptoAnalysisRequest {
  wallets: WalletData[];
  totalPortfolioValue: number;
  analysisRequest: string;
}