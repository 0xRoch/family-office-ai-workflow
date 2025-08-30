/**
 * Smart Crypto Fetcher - Dynamic token discovery across multiple chains
 *
 * Features:
 * - Automatic token discovery via transaction history
 * - Configuration-driven chains and tokens
 * - AI-powered unknown token research
 * - Persistent caching for performance
 */

import axios from 'axios';
import { ethers } from 'ethers';
import * as fs from 'fs-extra';
import * as path from 'path';
import {
  CryptoPosition,
  WalletData,
  TokenBalance,
  DeFiPosition
} from './types.js';

interface CryptoConfigV2 {
  discovery: {
    enabled: boolean;
    scanDepth: number;
    minValueUsd: number;
    maxTransactionsToScan: number;
    cacheExpiryHours: number;
  };
  chains: Record<string, ChainConfigV2>;
  tokenDatabase: Record<string, TokenMetadata>;
  priceCache: Record<string, CachedPrice>;
  lastScan: Record<string, string>;
  knownTokens: Record<string, TokenInfo[]>;
}

interface ChainConfigV2 {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  coingeckoId: string;
}

interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: string;
  coingeckoId?: string | undefined;
  type?: string | undefined;
  discoveredAt: string;
  verified: boolean;
}

interface CachedPrice {
  price: number;
  timestamp: string;
  source: string;
}

interface DiscoveredToken {
  address: string;
  firstSeen: string;
  lastSeen: string;
  transactionCount: number;
}

export class SmartCryptoFetcher {
  private config!: CryptoConfigV2;
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private configPath: string = 'data/crypto_config.json';

  constructor() {
    this.loadConfig();
    this.initializeProviders();
  }

  /**
   * Load configuration from external JSON file
   */
  private loadConfig(): void {
    try {
      this.config = fs.readJsonSync(this.configPath);
      console.log('✓ Loaded crypto configuration from', this.configPath);
    } catch (error) {
      console.error('✗ Failed to load crypto config:', error);
      throw new Error('Crypto configuration file not found or invalid');
    }
  }

  /**
   * Save configuration back to file
   */
  private saveConfig(): void {
    try {
      fs.writeJsonSync(this.configPath, this.config, { spaces: 2 });
    } catch (error) {
      console.error('✗ Failed to save crypto config:', error);
    }
  }

  /**
   * Initialize blockchain providers from configuration
   */
  private initializeProviders(): void {
    for (const [chainName, chainConfig] of Object.entries(this.config.chains)) {
      try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        this.providers.set(chainName, provider);
        console.log(`✓ Initialized ${chainName} provider`);
      } catch (error) {
        console.error(`✗ Failed to initialize ${chainName} provider:`, error);
      }
    }
  }

  /**
   * Discover tokens for a wallet by analyzing transaction history
   */
  private async discoverTokens(walletAddress: string, chainName: string): Promise<DiscoveredToken[]> {
    if (!this.config.discovery.enabled) {
      return [];
    }

    const chainConfig = this.config.chains[chainName];
    if (!chainConfig.explorerApiUrl) {
      console.log(`📝 No explorer API for ${chainName}, skipping token discovery`);
      return [];
    }

    console.log(`🔍 Discovering tokens for ${walletAddress} on ${chainName}...`);

    try {
      // Get recent ERC-20 token transfers
      const response = await axios.get(chainConfig.explorerApiUrl, {
        params: {
          module: 'account',
          action: 'tokentx',
          address: walletAddress,
          page: 1,
          offset: this.config.discovery.maxTransactionsToScan,
          sort: 'desc'
        },
        timeout: 10000
      });

      if (response.data.status !== '1') {
        console.log(`📝 No token transactions found for ${walletAddress} on ${chainName}`);
        return [];
      }

      // Analyze transactions to find unique token contracts
      const tokenMap = new Map<string, DiscoveredToken>();

      for (const tx of response.data.result || []) {
        const tokenAddress = tx.contractAddress?.toLowerCase();
        if (!tokenAddress) continue;

        if (tokenMap.has(tokenAddress)) {
          const token = tokenMap.get(tokenAddress)!;
          token.transactionCount++;
          token.lastSeen = tx.timeStamp;
        } else {
          tokenMap.set(tokenAddress, {
            address: tokenAddress,
            firstSeen: tx.timeStamp,
            lastSeen: tx.timeStamp,
            transactionCount: 1
          });
        }
      }

      const discoveredTokens = Array.from(tokenMap.values());
      console.log(`✓ Discovered ${discoveredTokens.length} unique tokens on ${chainName}`);

      return discoveredTokens;

    } catch (error: any) {
      console.warn(`⚠️  Token discovery failed for ${chainName}:`, error?.message || error);
      return [];
    }
  }

  /**
   * Research unknown token using AI and external APIs
   */
  private async researchToken(tokenAddress: string, chainName: string): Promise<TokenMetadata | null> {
    const provider = this.providers.get(chainName);
    if (!provider) return null;

    try {
      console.log(`🧠 Researching token ${tokenAddress} on ${chainName}...`);

      // Get basic token info from contract
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          'function symbol() view returns (string)',
          'function name() view returns (string)',
          'function decimals() view returns (uint8)',
          'function totalSupply() view returns (uint256)'
        ],
        provider
      );

      const [symbol, name, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.name().catch(() => 'Unknown Token'),
        tokenContract.decimals().catch(() => 18)
      ]);

      // Try to find on CoinGecko
      let coingeckoId: string | undefined;
      try {
        const searchResponse = await axios.get(`https://api.coingecko.com/api/v3/search?query=${symbol}`);
        const coins = searchResponse.data?.coins || [];
        const match = coins.find((coin: any) =>
          coin.symbol?.toLowerCase() === symbol.toLowerCase()
        );
        coingeckoId = match?.id;
      } catch (error) {
        console.warn(`Could not find ${symbol} on CoinGecko`);
      }

      const metadata: TokenMetadata = {
        address: tokenAddress,
        symbol,
        name,
        decimals,
        chain: chainName,
        coingeckoId,
        type: this.classifyToken(symbol, name),
        discoveredAt: new Date().toISOString(),
        verified: !!coingeckoId
      };

      // Cache the metadata
      const cacheKey = `${chainName}:${tokenAddress}`;
      this.config.tokenDatabase[cacheKey] = metadata;
      this.saveConfig();

      console.log(`✓ Researched ${symbol} (${name}) - ${metadata.verified ? 'verified' : 'unverified'}`);
      return metadata;

    } catch (error: any) {
      console.warn(`⚠️  Failed to research token ${tokenAddress}:`, error?.message || error);
      return null;
    }
  }

  /**
   * Simple AI-like token classification
   */
  private classifyToken(symbol: string, name: string): string {
    const symbolUpper = symbol.toUpperCase();
    const nameUpper = name.toUpperCase();

    if (['USDC', 'USDT', 'DAI', 'BUSD'].includes(symbolUpper)) {
      return 'stablecoin';
    }

    if (nameUpper.includes('WRAPPED') || symbolUpper.startsWith('W')) {
      return 'wrapped';
    }

    if (nameUpper.includes('LIQUIDITY') || nameUpper.includes('LP') || symbolUpper.includes('LP')) {
      return 'liquidity_pool';
    }

    if (nameUpper.includes('STAKED') || symbolUpper.includes('ST')) {
      return 'staking';
    }

    if (nameUpper.includes('GOVERNANCE') || nameUpper.includes('VOTE')) {
      return 'governance';
    }

    return 'utility';
  }

  /**
   * Get token price with caching
   */
  private async getTokenPrice(symbol: string, coingeckoId?: string): Promise<number> {
    const cacheKey = coingeckoId || symbol.toLowerCase();
    const cached = this.config.priceCache[cacheKey];

    // Check cache validity
    if (cached) {
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      const maxAge = this.config.discovery.cacheExpiryHours * 60 * 60 * 1000;

      if (cacheAge < maxAge) {
        return cached.price;
      }
    }

    try {
      const coinId = coingeckoId || symbol.toLowerCase();
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 10000 }
      );

      const price = response.data[coinId]?.usd || 0;

      // Cache the price
      this.config.priceCache[cacheKey] = {
        price,
        timestamp: new Date().toISOString(),
        source: 'coingecko'
      };
      this.saveConfig();

      return price;
    } catch (error: any) {
      console.warn(`Failed to get price for ${symbol}:`, error?.message || 'Unknown error');
      return 0;
    }
  }

  /**
   * Get all tokens for a wallet on a specific chain
   */
  private async getAllTokensForWallet(walletAddress: string, chainName: string): Promise<TokenBalance[]> {
    const tokens: TokenBalance[] = [];
    const provider = this.providers.get(chainName);
    const chainConfig = this.config.chains[chainName];

    if (!provider || !chainConfig) {
      console.error(`❌ No provider or config for chain: ${chainName}`);
      return tokens;
    }

    // 1. Check known tokens first (fast path)
    const knownTokens = this.config.knownTokens[chainName] || [];
    for (const tokenInfo of knownTokens) {
      try {
        const balance = await this.getTokenBalance(walletAddress, tokenInfo, provider);
        if (balance && balance.valueUsd >= this.config.discovery.minValueUsd) {
          tokens.push(balance);
        }
      } catch (error: any) {
        console.warn(`⚠️  Failed to check known token ${tokenInfo.symbol}:`, error?.message);
      }
    }

    // 2. Discover new tokens from transaction history
    if (this.config.discovery.enabled) {
      const discoveredTokens = await this.discoverTokens(walletAddress, chainName);

      for (const discovered of discoveredTokens) {
        // Skip if already checked in known tokens
        const alreadyKnown = knownTokens.some(kt =>
          kt.address.toLowerCase() === discovered.address.toLowerCase()
        );
        if (alreadyKnown) continue;

        // Check if we have metadata cached
        const cacheKey = `${chainName}:${discovered.address}`;
        let metadata = this.config.tokenDatabase[cacheKey];

        if (!metadata) {
          const researched = await this.researchToken(discovered.address, chainName);
          if (!researched) continue;
          metadata = researched;
        }

        // Get balance for discovered token
        try {
          const balance = await this.getTokenBalance(walletAddress, metadata, provider);
          if (balance && balance.valueUsd >= this.config.discovery.minValueUsd) {
            tokens.push(balance);
          }
        } catch (error: any) {
          console.warn(`⚠️  Failed to check discovered token ${metadata.symbol}:`, error?.message);
        }
      }
    }

    return tokens;
  }

  /**
   * Get balance for a specific token
   */
  private async getTokenBalance(
    walletAddress: string,
    tokenInfo: TokenInfo | TokenMetadata,
    provider: ethers.JsonRpcProvider
  ): Promise<TokenBalance | null> {
    try {
      const contract = new ethers.Contract(
        tokenInfo.address,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );

      const balance = await contract.balanceOf(walletAddress);
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, tokenInfo.decimals));

      if (balanceFormatted === 0) {
        return null;
      }

      const price = await this.getTokenPrice(tokenInfo.symbol, tokenInfo.coingeckoId);
      const valueUsd = balanceFormatted * price;

      return {
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        balance: balanceFormatted,
        decimals: tokenInfo.decimals,
        contractAddress: tokenInfo.address,
        priceUsd: price,
        valueUsd
      };
    } catch (error: any) {
      console.warn(`⚠️  Failed to get balance for ${tokenInfo.symbol}:`, error?.message);
      return null;
    }
  }

  /**
   * Fetch wallet data for a specific wallet on a specific chain
   */
  private async fetchWalletData(address: string, chainName: string): Promise<WalletData> {
    const provider = this.providers.get(chainName);
    const chainConfig = this.config.chains[chainName];

    if (!provider || !chainConfig) {
      throw new Error(`Provider not available for ${chainName}`);
    }

    // Get native token balance
    const nativeBalance = await provider.getBalance(address);
    const nativePrice = await this.getTokenPrice(chainConfig.nativeCurrency.symbol);
    const nativeValue = parseFloat(ethers.formatEther(nativeBalance)) * nativePrice;

    const tokens: TokenBalance[] = [{
      symbol: chainConfig.nativeCurrency.symbol,
      name: chainConfig.nativeCurrency.name,
      balance: parseFloat(ethers.formatEther(nativeBalance)),
      decimals: chainConfig.nativeCurrency.decimals,
      priceUsd: nativePrice,
      valueUsd: nativeValue
    }];

    // Get all ERC-20 tokens using smart discovery
    const erc20Tokens = await this.getAllTokensForWallet(address, chainName);
    tokens.push(...erc20Tokens);

    // Get DeFi positions (placeholder for now)
    const defiPositions: DeFiPosition[] = [];

    const totalValue = tokens.reduce((sum, token) => sum + token.valueUsd, 0) +
                     defiPositions.reduce((sum, pos) => sum + pos.totalValue, 0);

    return {
      address,
      chain: chainName,
      tokens,
      defiPositions,
      totalValue
    };
  }

  /**
   * Fetch all crypto positions across all configured wallets and chains
   */
  async fetchAllPositions(): Promise<CryptoPosition[]> {
    const cryptoWallets = process.env.CRYPTO_WALLETS?.split(',').map(w => w.trim()) || [];
    const minPositionValue = parseFloat(process.env.ANALYSIS_MIN_POSITION_EUR || '100');

    if (cryptoWallets.length === 0) {
      console.log('📝 No crypto wallets configured, skipping crypto data collection');
      return [];
    }

    console.log(`🔗 Smart fetching crypto data for ${cryptoWallets.length} wallets across ${Object.keys(this.config.chains).length} chains`);

    const allPositions: CryptoPosition[] = [];

    for (const walletAddress of cryptoWallets) {
      console.log(`📊 Processing wallet: ${walletAddress}`);

      for (const chainName of Object.keys(this.config.chains)) {
        try {
          const walletData = await this.fetchWalletData(walletAddress, chainName);
          const positions = this.convertToPositions(walletData);
          allPositions.push(...positions);

          console.log(`✓ ${chainName}: Found ${positions.length} positions (€${walletData.totalValue.toFixed(2)})`);
        } catch (error: any) {
          console.error(`✗ Failed to fetch ${chainName} data for ${walletAddress}:`, error?.message || error);
        }
      }
    }

    // Filter positions by minimum value
    const filteredPositions = allPositions.filter(
      pos => pos.marketValue >= minPositionValue
    );

    console.log(`📈 Total crypto positions: ${filteredPositions.length} (filtered from ${allPositions.length})`);
    return filteredPositions;
  }

  /**
   * Convert wallet data to portfolio positions format
   */
  private convertToPositions(walletData: WalletData): CryptoPosition[] {
    const positions: CryptoPosition[] = [];

    // Convert token balances to positions
    for (const token of walletData.tokens) {
      if (token.valueUsd > 0) {
        positions.push({
          symbol: token.symbol,
          name: token.name,
          balance: token.balance,
          currentPrice: token.priceUsd,
          marketValue: token.valueUsd,
          contractAddress: token.contractAddress,
          chain: walletData.chain,
          wallet: walletData.address,
          type: 'token',
          lastUpdated: new Date().toISOString()
        });
      }
    }

    // Convert DeFi positions
    for (const defiPos of walletData.defiPositions) {
      if (defiPos.totalValue > 0) {
        positions.push({
          symbol: `${defiPos.protocol}-${defiPos.type}`,
          name: `${defiPos.protocol} ${defiPos.type}`,
          balance: 1,
          currentPrice: defiPos.totalValue,
          marketValue: defiPos.totalValue,
          chain: walletData.chain,
          wallet: walletData.address,
          protocol: defiPos.protocol,
          type: defiPos.type as any,
          apy: defiPos.apy,
          lastUpdated: new Date().toISOString()
        });
      }
    }

    return positions;
  }

  /**
   * Check if crypto wallets are configured
   */
  static isCryptoConfigured(): boolean {
    const wallets = process.env.CRYPTO_WALLETS?.split(',').filter(w => w.trim()) || [];
    return wallets.length > 0;
  }
}

// Export for use in other modules
export default SmartCryptoFetcher;