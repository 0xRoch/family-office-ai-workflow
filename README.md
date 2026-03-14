# Family Office AI Workflow

A TypeScript-based family office system that uses AI agents to analyze financial positions and provide investment recommendations optimized for long-term wealth preservation.

## Features

- **Live Portfolio Dashboard**: Bloomberg-terminal-style web dashboard on port 3000 with real-time portfolio view, P&L tracking, allocation charts, and 15-year wealth projection
- **Portfolio Discovery**: Proactive AI-driven opportunity identification — finds concentration risks, missing exposures, and recommends 3-5 specific new investments with ISINs/tickers
- **Multi-Provider Banking Integration**: Connect to banking APIs (Powens, extensible for Plaid/TrueLayer)
- **Multi-Chain Crypto Analysis**: Track cryptocurrency holdings across Ethereum, Base, Polygon, and Arbitrum
- **Intelligent Change Detection**: Automatically detect and log meaningful portfolio changes
- **Sequential Analysis with Health Checks**: Connection health verification before data collection, sequential execution for reliability
- **Configurable Asset Classification**: Customizable patterns for categorizing investments
- **Specialist AI Agents**: Dedicated analysts for equities, funds, crypto, private equity, real estate, and alternative credit
- **Privacy-First**: All personal financial data stays on your machine

## Quick Start

### 1. Setup Environment

```bash
# Clone the repository
git clone <your-repo>
cd family-office-ai-workflow

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Configure Asset Patterns

```bash
# Copy the example patterns file
cp config/asset-patterns.example.json config/asset-patterns.json

# Edit the patterns file to match your portfolio
nano config/asset-patterns.json
```

The asset patterns file allows you to customize how investments are classified. For example:

```json
{
  "private_equity": {
    "names": ["YOUR_PE_COMPANY", "PRIVATE", "PE FUND"]
  },
  "real_estate": {
    "names": ["YOUR_REIT", "REAL ESTATE", "PROPERTY"]
  }
}
```

### 3. Configure Banking API

Edit `.env` file with your banking provider credentials:

```bash
# Powens API Configuration (for French banks)
POWENS_CLIENT_ID=your_client_id
POWENS_CLIENT_SECRET=your_client_secret
POWENS_DOMAIN=your-domain.biapi.pro
POWENS_USER_ID=your_user_id

# Optional: Crypto wallets to track
CRYPTO_WALLETS=0xYourWallet1,0xYourWallet2
```

### 4. Build and Run

```bash
# Build TypeScript
npm run build

# Run the workflow
./workflow.sh

# Or use the Claude Code slash command
/portfolio-run
```

## Configuration Files

### Asset Patterns (`config/asset-patterns.json`)
- **Private and Personal**: This file is gitignored to keep your investment patterns private
- **Customizable**: Define patterns that match your specific portfolio holdings
- **Fallback**: Uses `asset-patterns.example.json` if your personal file doesn't exist

### Environment Variables
- **Thresholds**: Configure significance thresholds for change detection
- **API Credentials**: Banking and crypto API configuration
- **Analysis Parameters**: Minimum position sizes and transaction thresholds

## Architecture

### Agents
- **OpenBanking Fetcher**: Banking API integration with change detection
- **Crypto Analyst**: Multi-chain cryptocurrency analysis
- **Equity Research Analyst**: Individual stock analysis
- **Fund Analyst**: ETF and mutual fund analysis
- **Real Estate Analyst**: Real estate investment analysis
- **Private Equity Analyst**: Private equity position analysis
- **Alternative Credit Analyst**: Credit and bond analysis
- **Portfolio Researcher**: Proactive opportunity discovery and gap analysis

### Data Flow
1. **Fetch**: Health-check connections, then collect positions from banking APIs and blockchain networks
2. **Detect**: Identify meaningful changes since last run (new/closed positions, >5% movements)
3. **Analyze**: Process positions sequentially through appropriate specialist agents
4. **Discover**: Identify portfolio gaps, concentration risks, and propose new investment opportunities
5. **Optimize**: Generate portfolio recommendations (BUY/HOLD/SELL + new opportunities)
6. **Log**: Record all changes and recommendations with timestamps

## Privacy & Security

- **Local Data**: All personal financial data stays on your machine
- **Gitignored**: Sensitive files (.env, data/, reports/) are automatically excluded
- **Configurable**: Personal investment patterns are kept in private config files
- **No Dummy Data**: Only works with real data from connected accounts

## Commands

```bash
# Complete workflow (fetch → analyze → discover → decide)
./workflow.sh
/portfolio-run

# Individual phases
./workflow.sh fetch       # Data collection only
./workflow.sh analyze     # Analysis only
./workflow.sh discover    # Find new investment opportunities
./workflow.sh decide      # Decision generation only
./workflow.sh status      # Show current status
./workflow.sh dashboard   # Open live portfolio dashboard

# TypeScript development
npm run build             # Compile TypeScript
npm run dev               # Development mode with auto-reload
npm run typecheck         # Type checking only
```

## Live Portfolio Dashboard

A Bloomberg-terminal-style web dashboard served on `http://localhost:3000` with:
- Real-time portfolio overview with total value and P&L
- Position-level detail with ratings and recommendations
- Asset allocation breakdown charts
- New investment opportunities from the discovery phase
- 15-year wealth projection based on historical portfolio growth

```bash
./workflow.sh dashboard
```

## Portfolio CLI Tracker

Display positions from `data/positions.json` in a terminal UI built with [Ink](https://github.com/vadimdemedes/ink).

```bash
npx portfolio-cli
npx portfolio-cli --file path/to/positions.json --currency USD
```

## Supported Providers

### Banking APIs
- **Powens**: French banking aggregation (BNP Paribas, Crédit Agricole, etc.)
- **Extensible**: Designed for easy addition of Plaid, TrueLayer, etc.

### Cryptocurrency
- **Ethereum**: Native ETH, ERC-20 tokens, DeFi protocols
- **Base**: Coinbase Layer 2, Base-native protocols
- **Polygon**: MATIC network, bridged assets
- **Arbitrum**: Ethereum Layer 2 with advanced DeFi

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build
```

## Contributing

This is a personal family office tool. The codebase is designed to be:
- **Privacy-focused**: Personal patterns stay private
- **Extensible**: Easy to add new providers and analysts
- **Configurable**: Adaptable to different portfolio structures
- **Type-safe**: Full TypeScript implementation

## License

Private/Personal use only - see LICENSE file for details.