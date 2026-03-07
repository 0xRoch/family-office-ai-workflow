# Family Office AI Workflow

## Overview
This family office system uses AI agents to analyze financial positions and provide investment recommendations optimized for long-term wealth preservation.

**IMPORTANT: Keep implementations simple and focused. Only implement what is explicitly requested. Don't add complexity without asking.**

## Agents Configuration

**IMPORTANT: Only use project-specific agents located in the `.claude/agents` folder of this project (symlinked as `/agents` for workflow compatibility). Do not use built-in Claude Code agents.**

### OpenBanking Fetcher
**Role**: Banking API integration with intelligent change detection
**Agent File**: `.claude/agents/openbanking-fetcher.md` (accessible via `agents/` symlink)
**Implementation**: TypeScript/Node.js agent (`src/openbanking-fetcher.ts`, compiled to `scripts/openbanking_fetcher.js`) with workflow.sh integration
**Purpose**: Fetch financial data from banking APIs and track meaningful portfolio changes

**Key Features:**
- **Change Detection**: Compares new vs previous positions to identify meaningful changes
- **User Context Collection**: Prompts user for reasoning behind position changes (rebalancing, tax-loss harvest, thesis change, etc.)
- **Smart Logging**: Records actual portfolio metrics (not empty summaries) to ledger.json
- **Position Tracking**: Logs new/closed positions and significant movements (>5% or >€1,000)
- **History Snapshots**: Saves timestamped position snapshots in `data/positions_history/`
- **Provider Extensible**: Currently supports Powens, designed for Plaid/TrueLayer expansion

**Current Provider: Powens API**
- Use `/auth/renew` for existing users (NOT `/auth/init`)
- User ID in .env must match the one with active connections
- Webview URL: `https://webview.powens.com/connect` (NOT sandbox domain)
- Fetches both accounts AND investments in single workflow run

**Ledger Integration:**
- `position_change`: New/closed positions with details
- `price_update`: Significant price movements
- `data_collection`: Real metrics (position counts, portfolio values)

**Usage:**
```bash
# Via workflow (recommended)
./workflow.sh fetch

# Direct agent usage
node scripts/openbanking_fetcher.js fetch
node scripts/openbanking_fetcher.js test_connection
node scripts/openbanking_fetcher.js status
```

### Equity Research Analyst
**Role**: Asset analysis and research
**Agent File**: `.claude/agents/equity-research-analyst.md` (accessible via `agents/` symlink)
**Purpose**: Analyze individual equity positions, generate research reports with buy/sell/hold recommendations

### Fund Analyst
**Role**: Mutual fund and ETF analysis
**Agent File**: `.claude/agents/fund-analyst.md` (accessible via `agents/` symlink)
**Purpose**: Analyze fund positions including expense ratios, performance metrics, and portfolio composition

### Portfolio Researcher
**Role**: Proactive investment opportunity discovery
**Agent File**: `.claude/agents/portfolio-researcher.md` (accessible via `agents/` symlink)
**Purpose**: Identify new investment opportunities by analyzing portfolio gaps, concentration risks, and missing exposures. Provides 3-5 specific actionable ideas with ISINs/tickers, rationale, and allocations.

**Key Features:**
- **Gap Analysis**: Identifies concentration risks, sector/geographic underweights, defensive positioning needs
- **Specific Recommendations**: Real ISINs/tickers (not generic suggestions) with concrete allocation guidance
- **Macro Overlay**: Considers interest rates, inflation, geopolitical trends, sector rotation
- **Family Office Alignment**: Ensures recommendations fit wealth preservation, tax efficiency, diversification principles
- **Actionable Output**: NEW_OPPORTUNITIES.md with implementation priority and entry strategies

**Usage:**
```bash
# Via workflow (recommended)
./workflow.sh discover

# Full workflow includes discovery
./workflow.sh full  # fetch → analyze → discover → decide
```

### Private Equity Analyst
**Role**: Private equity investment analysis
**Agent File**: `.claude/agents/private-equity-analyst.md` (accessible via `agents/` symlink)
**Purpose**: Evaluate private equity positions, illiquid investments, and alternative asset allocations

### Real Estate Analyst
**Role**: Real estate investment analysis
**Agent File**: `.claude/agents/real-estate-analyst.md` (accessible via `agents/` symlink)
**Purpose**: Analyze real estate positions including REITs, direct property holdings, and real estate funds

### Alternative Credit Analyst
**Role**: Alternative credit investment analysis
**Agent File**: `.claude/agents/alternative-credit-analyst.md` (accessible via `agents/` symlink)
**Purpose**: Evaluate credit investments, bonds, and fixed-income alternative strategies

### Crypto Analyst
**Role**: Cryptocurrency and DeFi investment analysis
**Agent File**: `.claude/agents/crypto-analyst.md` (accessible via `agents/` symlink)
**Implementation**: TypeScript/Node.js integration (`src/crypto-fetcher.ts`) with multi-chain support
**Purpose**: Analyze cryptocurrency holdings across multiple blockchains, DeFi positions, and yield optimization

**Key Features:**
- **Multi-Chain Support**: Ethereum, Base L2, Polygon, Arbitrum using public RPC endpoints
- **Wallet Tracking**: Same addresses checked across all supported chains
- **DeFi Analysis**: Lending, liquidity pools, staking rewards, yield farming positions
- **Cross-Chain Aggregation**: Unified portfolio view with EUR valuations
- **No API Keys Required**: Uses public endpoints and free APIs (CoinGecko, Etherscan)

**Supported Assets:**
- Native tokens (ETH, MATIC) and major tokens (USDC, USDT, DAI, WBTC)
- DeFi protocol positions (Uniswap, Aave, Base protocols like Aerodrome)
- Staking and yield farming positions
- Liquidity pool tokens and farming rewards

**Configuration:**
```bash
# .env configuration - single wallet array for all chains
CRYPTO_WALLETS=0xAddress1,0xAddress2,0xAddress3
```

### Portfolio Optimizer
**Role**: Aggregate analysis and recommendation generation
**Purpose**: Process research reports and generate final portfolio recommendations

## Workflow Execution

### 1. Data Collection Phase
- Execute OpenBanking fetcher agent to retrieve current positions from banking APIs
- Fetch cryptocurrency positions across all configured wallet addresses and chains (if configured)
- Detect changes since last fetch (new positions, closed positions, significant movements)
- Update `data/positions.json` with consolidated traditional + crypto data and save position snapshot
- Log meaningful changes and real metrics to `data/ledger.json`

### 2. Analysis Phase
- Identify all positions from consolidated data (equities, funds, private equity, real estate, crypto)
- Launch appropriate specialist analyst agents in parallel for each position:
  - **Crypto positions**: `crypto-analyst` for all blockchain assets and DeFi positions
  - **Equity positions**: `equity-research-analyst` for individual stocks
  - **Fund positions**: `fund-analyst` for ETFs and mutual funds
  - **Alternative positions**: Specialized agents for private equity, real estate, credit
- Store individual research reports in `reports/` directory

### 3. Discovery Phase (Proactive Opportunity Identification)
- Launch `portfolio-researcher` agent to analyze current portfolio state
- Identify concentration risks (positions >15%, top 3 holdings >35%, sector overweights)
- Map missing exposures (underrepresented sectors, geographic gaps, defensive positioning)
- Propose 3-5 specific new investment opportunities with:
  - Real ISINs/tickers (not generic suggestions)
  - Concrete allocation recommendations (% or EUR amounts)
  - Data-driven investment thesis and entry strategies
  - Confidence levels and expected timeframes
- Generate `NEW_OPPORTUNITIES.md` report with actionable recommendations
- Ensure alignment with family office principles (wealth preservation, tax efficiency, diversification)

### 4. Decision Phase
- Aggregate all research reports (including NEW_OPPORTUNITIES.md from discovery)
- Apply portfolio optimization rules:
  - Minimize transaction frequency
  - Optimize for long-term value
  - Consider tax implications
  - Maintain diversification principles
- Generate final `portfolio.md` report with:
  - BUY/HOLD/SELL recommendations on existing positions
  - NEW INVESTMENT OPPORTUNITIES section (if discovery was run)
  - Implementation timeline and priority ranking
  - Expected portfolio impact (risk reduction, diversification gains)

### 5. Logging Phase
- Record all recommendations in ledger
- Update position tracking
- Archive reports with timestamps

## Commands

### Claude Code Slash Command (Recommended)
```bash
/portfolio-run              # Complete workflow (fetch + analyze + discover + decide)
/portfolio-run fetch        # Data collection only
/portfolio-run analyze      # Analysis only
/portfolio-run discover     # Portfolio discovery - find new opportunities
/portfolio-run decide       # Decision generation only
/portfolio-run status       # Show portfolio status
/portfolio-run context      # Review pending changes needing user context
```

**User Context for Position Changes:**
After fetching data, if position changes are detected (new positions, closed positions, share changes), the system prompts for user reasoning. Available reasons:
- `rebalancing` - Portfolio rebalancing
- `tax_loss_harvest` - Tax-loss harvesting
- `tax_gain_harvest` - Tax-gain harvesting
- `thesis_change` - Investment thesis changed
- `profit_taking` - Taking profits
- `adding_to_winner` - Adding to winning position
- `averaging_down` - Averaging down on position
- `new_opportunity` - New investment opportunity
- `liquidity_need` - Liquidity needs
- `risk_reduction` - Risk reduction
- `dividend_reinvestment` - Dividend reinvestment
- `other` - Other reason (add notes)

This context is stored in the ledger and used by analyst agents to understand the rationale behind trades.

### Alternative: Bash Script
```bash
./workflow.sh               # Complete workflow (fetch + analyze + discover + decide)
./workflow.sh fetch         # Data collection only (accounts + investments)
./workflow.sh analyze       # Analysis only
./workflow.sh discover      # Portfolio discovery - find new opportunities
./workflow.sh decide        # Decision generation only
./workflow.sh status        # Show current status
```

## Configuration

### Powens Configuration
Set up environment variables for Powens API (French banking aggregation):

```bash
# Add to ~/.bashrc, ~/.zshrc, or create .env file
export POWENS_DOMAIN="your-domain-sandbox.biapi.pro"
export POWENS_CLIENT_ID="your_client_id"
export POWENS_CLIENT_SECRET="your_client_secret"  
export POWENS_USER_ID="your_user_id"  # Generated after user creation
```

**Setup Steps:**
1. Create Powens Console account at https://console.powens.com
2. Register organization and create domain
3. Create client application to get Client ID and Secret
4. Use Webview to connect French bank accounts (BNP Paribas, Crédit Agricole, etc.)
5. Generate user ID and set environment variables above

**Supported French Banks:**
- BNP Paribas, Crédit Agricole, Société Générale
- Boursorama, ING Direct, Crédit Mutuel
- Investment platforms: Degiro, eToro, etc.

### Crypto Configuration
Set up cryptocurrency wallet tracking (optional):

```bash
# Add to .env file - single wallet array for all chains
CRYPTO_WALLETS=0xAddress1,0xAddress2,0xAddress3
```

**Features:**
- **No API Keys Required**: Uses public RPC endpoints and free APIs
- **Multi-Chain Support**: Same addresses automatically checked on Ethereum, Base, Polygon, Arbitrum
- **DeFi Integration**: Tracks lending, staking, liquidity pool positions
- **Cross-Chain Aggregation**: Unified portfolio view with EUR valuations

**Supported Chains:**
- **Ethereum**: Native ETH, ERC-20 tokens, DeFi protocols
- **Base L2**: Coinbase's Layer 2, low fees, Base-native protocols
- **Polygon**: MATIC network, bridged assets, high activity DeFi
- **Arbitrum**: Ethereum Layer 2, advanced DeFi ecosystem

**Data Sources:**
- **Public RPCs**: ethereum.publicnode.com, mainnet.base.org, polygon-rpc.com
- **Free APIs**: CoinGecko (pricing), Etherscan-style APIs (transaction data)
- **DeFi Protocols**: Uniswap, Aave, Curve, Aerodrome (Base), and more

### Analysis Parameters
- Analysis frequency: Daily
- Minimum position size for analysis: €1,000
- Transaction threshold: >5% position change or >€10,000
- Long-term holding period: >12 months preferred

## File Structure
```
data/
├── positions.json       # Current consolidated positions (traditional + crypto)
├── ledger.json          # Complete transaction and decision log
├── pending_changes.json # Position changes awaiting user context (temporary)
├── positions_history/   # Timestamped position snapshots
reports/
├── [YYYY-MM-DD]/        # Daily report archives
│   ├── [SYMBOL].md      # Individual position analysis reports
│   ├── NEW_OPPORTUNITIES.md # Portfolio discovery recommendations
│   └── portfolio.md     # Aggregate portfolio optimization report
```

## Data Policy
**CRITICAL: NO DUMMY DATA**
- ONLY use real data from Powens API
- NEVER generate fake positions, balances, or transactions
- All portfolio analysis must be based on actual connected accounts
- If no data is available, report empty state - do not simulate

## Data Validation & Integrity

**CRITICAL: Prevent Incomplete Data Corruption**

The workflow includes safeguards to prevent analysis on incomplete or corrupted data:

### Fetch Phase Validation
**OpenBanking Fetcher** performs sanity checks before overwriting `positions.json`:
- **Position Count Check**: Aborts if >30% of positions disappear (likely partial fetch)
- **Portfolio Value Check**: Aborts if >20% value drop + >10% position loss (suspicious)
- **Preserves Previous Data**: On validation failure, keeps existing `positions.json` intact

**Example Scenario Prevented**:
```
Previous: 20 positions, €500k
API timeout returns: 5 positions, €100k (-75% positions, -80% value)
→ System detects suspicious drop and ABORTS
→ Logs error: "Likely partial fetch - aborting to protect data integrity"
→ User prompted to wait for sync or re-authenticate
```

### Analysis Phase Validation
**Before analyzing positions**, workflow checks:
- `positions.json` exists and is valid JSON
- Data structure is complete (has `.positions` field)
- Warns if data is >7 days old (stale data)
- Warns if portfolio value is €0 (incomplete fetch)

### Discovery Phase Validation
**Before discovering opportunities**, workflow validates:
- `positions.json` is valid and recent (<1 day for accurate gap analysis)
- Recommends fresh fetch if data is stale

### Recovery from Failed Fetch
If fetch fails validation:
1. Previous `positions.json` remains unchanged (safe)
2. Workflow stops with clear error message
3. User can:
   - Wait 5-10 minutes for bank sync to complete
   - Check connection: `./workflow.sh status`
   - Re-authenticate: `./workflow.sh setup`
   - Retry: `./workflow.sh fetch`

**Key Principle**: Better to stop with clear error than proceed with incomplete data leading to wrong investment recommendations.

## Implementation Notes

### TypeScript Architecture (Current)
**Core Implementation**: All components now implemented in TypeScript for better type safety and maintainability

**Build System:**
- TypeScript source files in `src/` directory
- Compiled JavaScript output in `dist/` directory
- Wrapper scripts in `scripts/` and root directory maintain CLI compatibility
- `npm run build` compiles TypeScript to JavaScript
- `package.json` defines dependencies and build scripts

**Key Components:**
- `src/openbanking-fetcher.ts` - Main banking integration with Powens API + crypto integration
- `src/crypto-fetcher.ts` - Multi-chain cryptocurrency data collection (Ethereum, Base, Polygon, Arbitrum)
- `src/analyze-orchestrator.ts` - Parallel analysis workflow orchestration with crypto analyst support
- `src/portfolio-orchestrator.ts` - Portfolio optimization report generation
- `src/types.ts` - Shared TypeScript interfaces and type definitions (including crypto interfaces)
- `.claude/commands/portfolio-run.js` - Claude Code slash command (JavaScript for compatibility)

**Dependencies:**
- **axios** - HTTP client for API requests
- **ethers** - Ethereum blockchain interaction and multi-chain support
- **fs-extra** - Enhanced file system operations
- **date-fns** - Date formatting and manipulation
- **glob** - File pattern matching
- **commander** - CLI argument parsing
- **dotenv** - Environment variable loading

### Legacy Python Architecture (Deprecated)
**OpenBanking Agent Architecture:**
- **Separation of Concerns**: Banking logic isolated in dedicated agent vs embedded in workflow
- **Change Detection**: Compares position snapshots to identify meaningful portfolio changes
- **Real Ledger Data**: Records actual metrics with position counts and values vs empty summaries
- **Position History**: Maintains timestamped snapshots for trend analysis and audit trail
- **Extensible Design**: Easy to add new banking providers (Plaid, TrueLayer, etc.)

**Technical Lessons Learned:**
- Powens connections require matching User ID in .env with active connections
- Agent-based fetching provides better error handling and isolation than inline implementation
- Change detection prevents ledger pollution with unchanged data
- Position history enables portfolio evolution tracking over time
- TypeScript migration maintains all Python functionality while improving type safety

## Optimization Rules
1. **Anti-Overtrading**: Require >5% position adjustment or significant fundamental change
2. **Tax Efficiency**: Consider holding periods and tax implications
3. **Diversification**: Maintain sector and geographic diversification  
4. **Rebalancing**: Quarterly portfolio rebalancing review
5. **Cash Management**: Maintain 3-6 months operating expenses in cash

---

## CRITICAL: Documentation Updates Required
**ALWAYS update CLAUDE.md when:**
- Adding new agents to `.claude/agents/` folder
- Modifying workflow.sh functionality 
- Changing data flow or file structures
- Adding new commands or usage patterns
- Updating API integrations or configurations
- Making architectural changes

**Documentation update checklist:**
- [ ] Update agent descriptions with file paths and purposes
- [ ] Update workflow execution steps if changed
- [ ] Update usage examples and commands
- [ ] Update implementation notes with lessons learned
- [ ] Update file structure documentation if changed

**Remember**: This documentation is the single source of truth for the project architecture and should reflect all changes immediately after implementation.