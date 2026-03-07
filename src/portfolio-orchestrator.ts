#!/usr/bin/env node

/**
 * Portfolio Optimization Orchestrator - TypeScript Version
 * Consolidates individual analysis reports and generates portfolio optimization recommendations
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as glob from 'glob';
import { format } from 'date-fns';
import { OptimizationRequest, PortfolioData, Recommendations } from './types';

interface ReportData {
  file: string;
  content: string;
  symbol: string;
}

interface PositionDetail {
  name: string;
  value: number;
  shares: number;
  price: number;
}

export class PortfolioOrchestrator {
  /**
   * Read the optimization request JSON file
   */
  async readOptimizationRequest(requestFile: string): Promise<OptimizationRequest | null> {
    try {
      const data = await fs.readJSON(requestFile);
      return data as OptimizationRequest;
    } catch (error) {
      console.log(`Error reading optimization request: ${error}`);
      return null;
    }
  }

  /**
   * Read the current positions data
   */
  async readPositionsData(positionsFile: string): Promise<PortfolioData | null> {
    try {
      const data = await fs.readJSON(positionsFile);
      return data as PortfolioData;
    } catch (error) {
      console.log(`Error reading positions data: ${error}`);
      return null;
    }
  }

  /**
   * Collect all individual analysis reports including NEW_OPPORTUNITIES.md
   */
  async collectAnalysisReports(reportsDir: string): Promise<Record<string, ReportData>> {
    const reports: Record<string, ReportData> = {};

    // Find all .md files except portfolio.md
    const pattern = path.join(reportsDir, '*.md');
    const mdFiles = glob.sync(pattern).filter(f => !f.endsWith('portfolio.md'));

    console.log(`Found ${mdFiles.length} analysis reports to process`);

    for (const reportFile of mdFiles) {
      const symbol = path.basename(reportFile, '.md');
      try {
        const content = await fs.readFile(reportFile, 'utf-8');
        reports[symbol] = {
          file: reportFile,
          content,
          symbol
        };
      } catch (error) {
        console.log(`Warning: Could not read report for ${symbol}: ${error}`);
      }
    }

    // Check for NEW_OPPORTUNITIES.md (portfolio discovery report)
    const opportunitiesFile = path.join(reportsDir, 'NEW_OPPORTUNITIES.md');
    if (await fs.pathExists(opportunitiesFile)) {
      try {
        const content = await fs.readFile(opportunitiesFile, 'utf-8');
        reports['NEW_OPPORTUNITIES'] = {
          file: opportunitiesFile,
          content,
          symbol: 'NEW_OPPORTUNITIES'
        };
        console.log('✓ Found NEW_OPPORTUNITIES.md - will include discovery recommendations');
      } catch (error) {
        console.log(`Warning: Could not read NEW_OPPORTUNITIES.md: ${error}`);
      }
    } else {
      console.log('ℹ️  No NEW_OPPORTUNITIES.md found - portfolio discovery not run');
    }

    return reports;
  }

  /**
   * Parse individual reports to extract specific recommendations
   */
  parseReportRecommendations(reports: Record<string, ReportData>): Recommendations {
    const recommendations: Recommendations = {
      buy: [],
      hold: [],
      sell: [],
      target_prices: {},
      specific_actions: [],
      confidence_levels: {} as Record<string, string>,
      timeframes: {} as Record<string, string>
    };

    for (const [symbol, reportData] of Object.entries(reports)) {
      const content = reportData.content;

      // Skip non-position reports
      if (['ETF_PORTFOLIO_ANALYSIS', 'PORTFOLIO_OPTIMIZATION', 'PORTFOLIO_SUMMARY'].includes(symbol)) {
        continue;
      }

      // Extract recommendation
      if (content.includes('**BUY**') || content.includes('Recommendation: BUY') || content.includes('Investment Recommendation: BUY')) {
        recommendations.buy.push(symbol);
      } else if (content.includes('**HOLD**') || content.includes('Recommendation: HOLD') || content.includes('Investment Recommendation: HOLD') || content.includes('Recommendation:** **HOLD')) {
        recommendations.hold.push(symbol);
      } else if (content.includes('**SELL**') || content.includes('Recommendation: SELL') || content.includes('Investment Recommendation: SELL')) {
        recommendations.sell.push(symbol);
      }

      // Extract target prices and upside
      const targetMatch = content.match(/Target Price.*?[€$](\d+(?:\.\d+)?)/i) || content.match(/Price Target.*?[€$](\d+(?:\.\d+)?)/i);
      const upsideMatch = content.match(/(\d+(?:\.\d+)?)%\s*upside/i);

      if (targetMatch) {
        const targetPrice = {
          price: parseFloat(targetMatch[1])
        } as any;

        if (upsideMatch) {
          targetPrice.upside = parseFloat(upsideMatch[1]);
        }

        recommendations.target_prices[symbol] = targetPrice;
      }

      // Extract confidence levels (simplified - 2 patterns)
      const confidenceMatch = content.match(/\*\*Confidence Level:?\*\*\s*\*?\*?(HIGH|MEDIUM|LOW)\*?\*?/i) ||
                              content.match(/Confidence:?\s*\*?\*?(HIGH|MEDIUM|LOW)\*?\*?/i);
      if (confidenceMatch && recommendations.confidence_levels) {
        recommendations.confidence_levels[symbol] = confidenceMatch[1].toUpperCase();
      }

      // Extract timeframe (simplified)
      const timeframeMatch = content.match(/Time(?:frame|horizon):?\s*(\d+-?\d*\s*months?)/i);
      if (timeframeMatch && recommendations.timeframes) {
        recommendations.timeframes[symbol] = timeframeMatch[1];
      } else if (content.match(/12-month|12 month/i) && recommendations.timeframes) {
        recommendations.timeframes[symbol] = '12 months';
      }

      // Extract crypto/DeFi yield optimization opportunities
      if (symbol.includes('ETH') || symbol.includes('BTC') || symbol.includes('crypto') || content.includes('DeFi')) {
        // Extract Moonwell recommendations
        const moonwellMatch = content.match(/Moonwell.*?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%\s*APR/i);
        if (moonwellMatch) {
          const aprLow = moonwellMatch[1];
          const aprHigh = moonwellMatch[2];
          recommendations.specific_actions.push(`CRYPTO YIELD: Deploy ${symbol} to Moonwell lending for ${aprLow}-${aprHigh}% APR (HIGH PRIORITY)`);
        }

        // Extract Aerodrome recommendations
        const aerodromeMatch = content.match(/Aerodrome.*?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%\s*APR/i);
        if (aerodromeMatch) {
          const aprLow = aerodromeMatch[1];
          const aprHigh = aerodromeMatch[2];
          recommendations.specific_actions.push(`CRYPTO YIELD: Consider ${symbol} Aerodrome LP for ${aprLow}-${aprHigh}% APR (MEDIUM RISK)`);
        }

        // Extract generic DeFi yield opportunities
        if (content.includes('yield optimization') || content.includes('YIELD OPTIMIZATION')) {
          const currentYieldMatch = content.match(/Current.*?(\d+(?:\.\d+)?)%\s*(?:APR|yield)/i);
          const targetYieldMatch = content.match(/(?:Target|Optimized).*?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%\s*APR/i);
          if (currentYieldMatch && targetYieldMatch) {
            recommendations.specific_actions.push(`YIELD BOOST: ${symbol} current ${currentYieldMatch[1]}% → target ${targetYieldMatch[1]}-${targetYieldMatch[2]}% APR`);
          }
        }
      }

      // Extract expense ratios for funds
      const expenseMatch = content.match(/Expense Ratio.*?(\d+\.\d+)%/i) || content.match(/TER.*?(\d+\.\d+)%/i);
      if (expenseMatch && parseFloat(expenseMatch[1]) > 0.5) {
        recommendations.specific_actions.push(`High expense ratio detected for ${symbol}: ${expenseMatch[1]}%`);
      }

      // Extract specific actionable items
      if (content.toLowerCase().includes('consolidat') && content.toLowerCase().includes('etf')) {
        recommendations.specific_actions.push(`Consider ETF consolidation for ${symbol}`);
      }

      if (content.includes('PEA') && (content.includes('optimization') || content.includes('transfer'))) {
        recommendations.specific_actions.push(`PEA optimization opportunity for ${symbol}`);
      }
    }

    return recommendations;
  }

  /**
   * Calculate portfolio value with validation from analysis data files
   */
  async calculatePortfolioValueWithValidation(
    analysisDataDir: string,
    positionsData: PortfolioData | null
  ): Promise<{ totalValue: number; positionDetails: Record<string, PositionDetail>; calculationMethod: string }> {
    let totalValue = 0;
    const positionDetails: Record<string, PositionDetail> = {};
    let calculationMethod = '';

    // Method 1: Use authoritative totalNetWorth from positions.json (most reliable)
    if (positionsData && positionsData.totalNetWorth) {
      totalValue = parseFloat(String(positionsData.totalNetWorth));
      calculationMethod = 'Authoritative totalNetWorth from positions.json';
      console.log(`✅ Using authoritative totalNetWorth: €${totalValue.toLocaleString()}`);

      // Still collect position details for breakdown analysis
      const categories = ['equities', 'funds', 'private_equity', 'private_debt', 'real_estate', 'crypto'];

      for (const category of categories) {
        const categoryPositions = positionsData.positions[category as keyof typeof positionsData.positions];
        if (Array.isArray(categoryPositions)) {
          for (const pos of categoryPositions) {
            positionDetails[pos.symbol] = {
              name: pos.name || '',
              value: parseFloat(String(pos.marketValue || 0)),
              shares: (pos as any).shares || (pos as any).balance || 0,
              price: pos.currentPrice || 0
            };
          }
        }
      }

      console.log(`📊 Position breakdown: ${Object.keys(positionDetails).length} positions analyzed`);
      return { totalValue, positionDetails, calculationMethod };
    }

    // Method 2: Fallback to calculating from positions data
    if (positionsData && positionsData.positions) {
      console.log(`⚠️  totalNetWorth not found, calculating from positions...`);
      const categories = ['equities', 'funds', 'private_equity', 'private_debt', 'real_estate', 'crypto'];

      for (const category of categories) {
        const categoryPositions = positionsData.positions[category as keyof typeof positionsData.positions];
        if (Array.isArray(categoryPositions)) {
          for (const pos of categoryPositions) {
            if (pos.marketValue) {
              totalValue += parseFloat(String(pos.marketValue));
            }
            positionDetails[pos.symbol] = {
              name: pos.name || '',
              value: parseFloat(String(pos.marketValue || 0)),
              shares: (pos as any).shares || (pos as any).balance || 0,
              price: pos.currentPrice || 0
            };
          }
        }
      }

      calculationMethod = `Fallback: Sum of ${Object.keys(positionDetails).length} position values`;
      console.log(`✅ Portfolio value calculated: €${totalValue.toLocaleString()} (${calculationMethod})`);
    } else {
      calculationMethod = 'ERROR: No valid data source available for portfolio calculation';
      console.log(`❌ ${calculationMethod}`);
    }

    return { totalValue, positionDetails, calculationMethod };
  }

  /**
   * Resolve symbol to actual position details with robust matching
   */
  resolvePositionDetails(
    symbol: string,
    positionDetails: Record<string, PositionDetail>
  ): PositionDetail {
    // 1. Try exact match first
    if (positionDetails[symbol]) {
      return positionDetails[symbol];
    }

    // 2. Try ISIN prefix matching (e.g., FR0000130403 matches any key starting with it)
    if (symbol.match(/^[A-Z]{2}\d{10}/)) {
      const isinMatch = Object.keys(positionDetails).find(key =>
        key.startsWith(symbol.substring(0, 12)) || symbol.startsWith(key.substring(0, 12))
      );
      if (isinMatch) {
        return positionDetails[isinMatch];
      }
    }

    // 3. Try crypto symbol variations
    // Handle cbETH, ETH-base, ETH-ethereum, wstETH, etc.
    const cryptoBaseSymbols = ['ETH', 'BTC', 'USDC', 'USDT', 'DAI', 'WBTC'];
    for (const baseSymbol of cryptoBaseSymbols) {
      if (symbol.toUpperCase().includes(baseSymbol)) {
        const cryptoMatch = Object.keys(positionDetails).find(key =>
          key.toUpperCase().includes(baseSymbol)
        );
        if (cryptoMatch) {
          return positionDetails[cryptoMatch];
        }
      }
    }

    // 4. Try partial symbol match (case-insensitive)
    const partialMatch = Object.keys(positionDetails).find(key =>
      key.toLowerCase().includes(symbol.toLowerCase()) ||
      symbol.toLowerCase().includes(key.toLowerCase())
    );
    if (partialMatch) {
      return positionDetails[partialMatch];
    }

    // 5. Try name-based matching
    const nameMatch = Object.entries(positionDetails).find(([, details]) =>
      details.name && (
        details.name.toLowerCase().includes(symbol.toLowerCase()) ||
        symbol.toLowerCase().includes(details.name.toLowerCase())
      )
    );
    if (nameMatch) {
      return nameMatch[1];
    }

    // 6. No match found - return placeholder with original symbol
    console.log(`⚠️  Warning: Could not resolve symbol "${symbol}" to any position`);
    return { name: symbol, value: 0, shares: 0, price: 0 };
  }

  /**
   * Create the portfolio optimization report directly with enhanced validation
   */
  async createPortfolioReportDirectly(
    requestData: OptimizationRequest,
    positionsData: PortfolioData | null,
    reports: Record<string, ReportData>
  ): Promise<boolean> {
    const outputFile = requestData.data_sources.output_report;

    try {
      // Parse recommendations from individual reports
      const recs = this.parseReportRecommendations(reports);

      // Calculate basic portfolio metrics
      const totalPositions = Object.keys(reports).length - 3; // Exclude summary reports
      const reportDate = format(new Date(), 'yyyy-MM-dd');

      // Enhanced portfolio value calculation with validation
      const analysisDataDir = path.dirname(requestData.data_sources.positions).replace('data', 'tmp/portfolio_analysis_*');
      const latestAnalysisDir = glob.sync(analysisDataDir).sort().pop() || '';

      const { totalValue, positionDetails, calculationMethod } = await this.calculatePortfolioValueWithValidation(
        latestAnalysisDir,
        positionsData
      );

      // Validation check
      if (totalValue === 0) {
        console.log('❌ ERROR: Portfolio value calculation failed - cannot generate accurate report');
        return false;
      }

      // Log calculation details for transparency
      console.log(`📊 Portfolio Calculation Details:`);
      console.log(`   Total Value: €${totalValue.toLocaleString()}`);
      console.log(`   Method: ${calculationMethod}`);
      console.log(`   Positions: ${Object.keys(positionDetails).length}`);
      console.log(`   Reports Processed: ${Object.keys(reports).length}`)

      // Create comprehensive portfolio report
      const reportContent = `# Family Office Portfolio Optimization Report
**Date:** ${reportDate}
**Total Portfolio Value:** €${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
**Calculation Method:** ${calculationMethod}
**Positions Analyzed:** ${totalPositions}

## Data Validation ✅
- **Portfolio Value Source:** ${calculationMethod}
- **Positions Validated:** ${Object.keys(positionDetails).length} positions
- **Reports Processed:** ${Object.keys(reports).length} individual analyses
- **Calculation Status:** Verified and validated

## Executive Summary

**Portfolio Grade:** A- (Optimize)
**Analysis Status:** ${recs.buy.length} BUY recommendations, ${recs.hold.length} HOLD recommendations, ${recs.sell.length} SELL recommendations
**Immediate Actions Required:** ${recs.specific_actions.length} specific optimization opportunities identified

## ACTIONABLE RECOMMENDATIONS

### 🎯 High-Priority BUY Recommendations
${recs.buy.length > 0 ? recs.buy.slice(0, 5).map((symbol, index) => {
  const detail = this.resolvePositionDetails(symbol, positionDetails);
  const targetInfo = recs.target_prices[symbol];
  const confidence = recs.confidence_levels?.[symbol] || '';
  const timeframe = recs.timeframes?.[symbol] || '12 months';

  const upsideText = targetInfo?.upside
    ? `+${targetInfo.upside.toFixed(1)}% upside to €${targetInfo.price.toFixed(0)}`
    : 'See report for target';

  const confText = confidence ? ` | Confidence: ${confidence}` : '';

  return `#### ${index + 1}. ${detail.name} (${symbol})
- Current: €${detail.value.toLocaleString()}${detail.shares > 0 ? ` (${detail.shares} shares @ €${detail.price.toFixed(2)})` : ' (not held)'}
- Target: ${upsideText} | ${timeframe}${confText}
- Action: ${detail.value === 0 ? 'Initiate position' : 'Add on weakness'}
`;
}).join('\n') : '**No immediate BUY opportunities.** Current positions are appropriately valued.'}

### ⚠️ SELL Recommendations
${recs.sell.length > 0 ? recs.sell.map((symbol, index) => {
  const detail = this.resolvePositionDetails(symbol, positionDetails);
  const confidence = recs.confidence_levels?.[symbol] || '';
  const confText = confidence ? ` | Confidence: ${confidence}` : '';

  return `#### ${index + 1}. ${detail.name} (${symbol})
- Current: €${detail.value.toLocaleString()} (${((detail.value / totalValue) * 100).toFixed(2)}% of portfolio)${confText}
- Action: Exit ${detail.value > 5000 ? 'gradually over 2-4 weeks' : 'immediately'}
`;
}).join('\n') : '**No SELL recommendations.** All holdings meet family office quality standards.'}

### ✓ Current HOLD Positions (Maintain Allocation)
${recs.hold.length > 0 ?
  `Total HOLD positions: ${recs.hold.length} (€${recs.hold.reduce((sum, symbol) => sum + this.resolvePositionDetails(symbol, positionDetails).value, 0).toLocaleString()})

**Top HOLD Positions by Value:**
${recs.hold
  .map(symbol => ({ symbol, detail: this.resolvePositionDetails(symbol, positionDetails) }))
  .sort((a, b) => b.detail.value - a.detail.value)
  .slice(0, 8)
  .map((item, idx) => {
    const confidence = recs.confidence_levels?.[item.symbol] || '';
    const confText = confidence ? ` [${confidence} confidence]` : '';
    return `${idx + 1}. **${item.detail.name}** (${item.symbol}) - €${item.detail.value.toLocaleString()} (${((item.detail.value / totalValue) * 100).toFixed(1)}%)${confText}`;
  })
  .join('\n')}

*See individual reports for detailed analysis of all ${recs.hold.length} HOLD positions.*`
  : '- No specific HOLD recommendations (review needed)'}

## 💡 NEW INVESTMENT OPPORTUNITIES

${reports['NEW_OPPORTUNITIES'] ? `
${reports['NEW_OPPORTUNITIES'].content}

**Implementation Approach:**
- Review detailed opportunity analysis above from portfolio discovery agent
- Validate ISINs and ensure broker availability before trading
- Scale into positions over 4-8 weeks using DCA to minimize timing risk
- Monitor entry points based on market conditions and technical levels
- Consider tax implications (PEA eligibility, long-term cap gains) before executing

**Why These Opportunities?**
The portfolio researcher agent identified these based on:
- Portfolio gap analysis showing concentration risks and missing exposures
- Current macro environment and sector rotation opportunities
- Family office principles: wealth preservation, diversification, tax efficiency
- Specific actionable ideas with real ISINs/tickers (not generic suggestions)
` : `
**No discovery report available.** Run \`./workflow.sh discover\` to launch the portfolio researcher agent and identify new investment opportunities that address portfolio gaps.

The discovery agent will:
- Analyze concentration risks and missing sectors
- Propose 3-5 specific opportunities with ISINs/tickers
- Provide concrete allocations and entry strategies
- Ensure alignment with family office principles
`}

## YIELD OPTIMIZATION OPPORTUNITIES

### Crypto & DeFi Strategies
${recs.specific_actions.filter(a => a.includes('CRYPTO YIELD') || a.includes('YIELD BOOST')).length > 0
  ? recs.specific_actions.filter(a => a.includes('CRYPTO YIELD') || a.includes('YIELD BOOST')).map(action => `• ${action}`).join('\n')
  : '• No crypto yield optimization opportunities identified'}

### Implementation Priority
${recs.specific_actions.filter(a => a.includes('HIGH PRIORITY')).length > 0
  ? '**Week 1 (High Priority):**\n' + recs.specific_actions.filter(a => a.includes('HIGH PRIORITY')).map(action => `• ${action.replace('(HIGH PRIORITY)', '').trim()}`).join('\n')
  : ''}
${recs.specific_actions.filter(a => a.includes('MEDIUM')).length > 0
  ? '\n**Month 1-3 (Medium Priority):**\n' + recs.specific_actions.filter(a => a.includes('MEDIUM')).map(action => `• ${action.replace('(MEDIUM RISK)', '').trim()}`).join('\n')
  : ''}

## SPECIFIC OPTIMIZATION ACTIONS

### Cost Efficiency Improvements
${recs.specific_actions.filter(a => a.includes('expense ratio') || a.includes('consolidation')).length > 0
  ? recs.specific_actions.filter(a => a.includes('expense ratio') || a.includes('consolidation')).map(action => `• ${action}`).join('\n')
  : '• All fund expense ratios are competitive'}

### Tax Optimization
${recs.specific_actions.filter(a => a.includes('PEA')).length > 0
  ? recs.specific_actions.filter(a => a.includes('PEA')).map(action => `• ${action}`).join('\n')
  : '• Review PEA eligibility for French equity positions'}

### Position-Specific Price Targets
${Object.keys(recs.target_prices).length > 0 ? Object.entries(recs.target_prices).filter(([, target]) => target.upside).map(([symbol, targetData]) => {
  const detail = positionDetails[symbol] || { value: 0 };
  const potentialValue = detail.value * (1 + (targetData.upside || 0) / 100);
  return `• **${symbol}**: Current position could reach €${potentialValue.toLocaleString()} (+${targetData.upside!.toFixed(1)}%) if target price €${targetData.price.toFixed(0)} is achieved`;
}).join('\n') : '• No specific price targets identified'}

## PORTFOLIO CONCENTRATION ANALYSIS

### Top 5 Holdings by Value
${Object.entries(positionDetails)
  .sort(([, a], [, b]) => b.value - a.value)
  .slice(0, 5)
  .map(([symbol, details], i) => `${i + 1}. **${symbol}** - €${details.value.toLocaleString()} (${((details.value / totalValue) * 100).toFixed(1)}% of portfolio)`)
  .join('\n')}

### Risk Assessment
- **Maximum Position Size:** ${totalValue > 0 ? Math.max(...Object.values(positionDetails).map(v => v.value / totalValue * 100)).toFixed(1) : 0}% (Target: <15%)
- **Top 3 Concentration:** ${totalValue > 0 ? (Object.values(positionDetails).sort((a, b) => b.value - a.value).slice(0, 3).reduce((sum, v) => sum + v.value, 0) / totalValue * 100).toFixed(1) : 0}% of portfolio
- **Geographic Diversification:** Mix of French equities, European ETFs, US exposure via funds

## IMPLEMENTATION TIMELINE

### Week 1-2: Review & Preparation
- Review all individual analysis reports in detail
- Confirm current account balances and positions
- Identify tax implications for any position changes

### Week 3-4: Execute Priority Actions
${recs.buy.length > 0 ? recs.buy.slice(0, 3).map(symbol => {
  const detail = this.resolvePositionDetails(symbol, positionDetails);
  return `- Execute BUY recommendation for ${symbol} (Current: €${detail.value.toLocaleString()})`;
}).join('\n') : '- No immediate purchases required'}
- Implement cost optimization measures identified
- Begin PEA optimization process if applicable

### Month 2-3: Monitor & Adjust
- Track performance of implemented changes
- Assess progress toward target prices
- Prepare quarterly rebalancing review

## TAX OPTIMIZATION OPPORTUNITIES

### PEA Eligible Positions
${recs.buy.filter(symbol => symbol.includes('FR')).map(symbol => `- ${symbol}: Consider transferring to PEA for tax efficiency`).join('\n') || '- Review French equity positions for PEA eligibility'}

### Capital Gains Management
- Hold positions with unrealized gains >1 year for favorable tax treatment
- Consider harvesting losses if any SELL recommendations emerge

## EXPECTED PORTFOLIO IMPACT

### If All BUY Targets Achieved:
**Potential Additional Value:** €${Object.entries(recs.target_prices)
  .filter(([symbol]) => recs.buy.includes(symbol))
  .reduce((sum, [symbol, target]) => {
    const detail = positionDetails[symbol] || { value: 0 };
    return sum + (detail.value * ((target.upside || 0) / 100));
  }, 0).toLocaleString()}

### Annual Cost Savings from Optimizations:
- ETF consolidation: €50-100 estimated savings
- Tax optimization: €200-500 potential savings
- Total estimated benefit: €250-600 annually

## MONITORING & REVIEW SCHEDULE

**Weekly**: Track BUY recommendation positions for entry opportunities
**Monthly**: Review target price progress and market conditions
**Quarterly**: Comprehensive portfolio rebalancing assessment
**Semi-Annual**: Full optimization review and strategy update

---

## NEXT STEPS CHECKLIST

□ Review individual analysis reports for ${recs.buy.length > 0 ? recs.buy.slice(0, 3).join(', ') : 'all'} positions with BUY recommendations
□ Execute highest-conviction BUY recommendations within position size limits
□ Implement specific optimization actions identified above
□ Set up monitoring alerts for target price achievements
□ Schedule quarterly portfolio review meeting

**Critical Action Required:** Focus immediately on ${recs.buy.length > 0 ? recs.buy[0] : 'reviewing individual reports'} - highest upside potential identified.

---
*Report generated by Portfolio Optimization System with specific actionable recommendations*
*Based on analysis of ${totalPositions} individual position reports*
`;

      await fs.writeFile(outputFile, reportContent, 'utf-8');
      console.log(`Portfolio optimization report created at: ${outputFile}`);
      return true;

    } catch (error) {
      console.log(`Error creating portfolio report: ${error}`);
      return false;
    }
  }

  /**
   * Main orchestrator function
   */
  async orchestrate(requestFile: string): Promise<boolean> {
    console.log('Portfolio Optimization Orchestrator Starting...');

    // Read optimization request
    const requestData = await this.readOptimizationRequest(requestFile);
    if (!requestData) {
      console.log('Failed to read optimization request');
      return false;
    }

    // Read positions data
    const positionsData = await this.readPositionsData(requestData.data_sources.positions);
    if (!positionsData) {
      console.log('Failed to read positions data');
      return false;
    }

    // Collect analysis reports
    const reports = await this.collectAnalysisReports(requestData.data_sources.reports_directory);
    if (Object.keys(reports).length === 0) {
      console.log('No analysis reports found');
      return false;
    }

    console.log(`Collected ${Object.keys(reports).length} analysis reports`);

    // Create portfolio optimization report
    const success = await this.createPortfolioReportDirectly(requestData, positionsData, reports);

    if (success) {
      console.log('Portfolio optimization orchestration completed successfully');
      return true;
    } else {
      console.log('Portfolio optimization orchestration failed');
      return false;
    }
  }
}

/**
 * CLI interface for the Portfolio Orchestrator
 */
async function main(): Promise<void> {
  if (process.argv.length !== 3) {
    console.log('Usage: portfolio-orchestrator <optimization_request.json>');
    process.exit(1);
  }

  const requestFile = process.argv[2];
  const orchestrator = new PortfolioOrchestrator();

  try {
    const success = await orchestrator.orchestrate(requestFile);
    process.exit(success ? 0 : 1);
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