# Family Office AI Workflow

A TypeScript-based family office system that uses AI agents to analyze financial positions and provide investment recommendations optimized for long-term wealth preservation.

## Features

- **Multi-Provider Banking Integration**: Connect to banking APIs (Powens, extensible for Plaid/TrueLayer)
- **Multi-Chain Crypto Analysis**: Track cryptocurrency holdings across Ethereum, Base, Polygon, and Arbitrum
- **Intelligent Change Detection**: Automatically detect and log meaningful portfolio changes
- **Configurable Asset Classification**: Customizable patterns for categorizing investments
- **Parallel Analysis**: Process multiple positions simultaneously using specialized AI agents
- **Privacy-First**: Personal patterns and data stay local and private

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

### Data Flow
1. **Fetch**: Collect positions from banking APIs and blockchain networks
2. **Detect**: Identify meaningful changes since last run
3. **Analyze**: Process positions through appropriate specialist agents
4. **Optimize**: Generate portfolio recommendations
5. **Log**: Record all changes and recommendations with timestamps

## Privacy & Security

- **Local Data**: All personal financial data stays on your machine
- **Gitignored**: Sensitive files (.env, data/, reports/) are automatically excluded
- **Configurable**: Personal investment patterns are kept in private config files
- **No Dummy Data**: Only works with real data from connected accounts

## Commands

```bash
# Complete workflow
./workflow.sh
/portfolio-run

# Individual phases
./workflow.sh fetch     # Data collection only
./workflow.sh analyze   # Analysis only
./workflow.sh decide    # Decision generation only
./workflow.sh status    # Show current status

# TypeScript development
npm run build           # Compile TypeScript
npm run dev            # Development mode with auto-reload
npm run typecheck      # Type checking only
```

## Portfolio CLI Tracker

Display the latest consolidated positions from `data/positions.json` in a rich terminal UI built with [Ink](https://github.com/vadimdemedes/ink).

```bash
# Compile TypeScript sources (required before running the CLI)
npm run build

# Show portfolio snapshot using the default data/positions.json
npx portfolio-cli

# Or point to a custom positions file and currency code
npx portfolio-cli --file path/to/positions.json --currency USD
```

> **Note:** Install the new runtime dependencies locally (`npm install`) if you have not already done so. The CLI gracefully reports when the positions file is missing or empty.

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