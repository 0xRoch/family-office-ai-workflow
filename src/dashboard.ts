#!/usr/bin/env node

import * as fs from 'fs-extra';
import * as path from 'path';
import * as http from 'http';
import { glob } from 'glob';
import { PortfolioData, Position, LedgerEntry } from './types';

const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

interface HistoryPoint {
  date: string;
  value: number;
}

interface Recommendation {
  symbol: string;
  name: string;
  rating: string;
  value: number;
  pnl: string;
  action: string;
  account: string;
}

interface Opportunity {
  name: string;
  isin: string;
  allocation: string;
  confidence: string;
  priority: number;
  rationale: string;
}

function loadPortfolioData(): PortfolioData | null {
  const filePath = path.join(DATA_DIR, 'positions.json');
  if (!fs.existsSync(filePath)) return null;
  return fs.readJsonSync(filePath) as PortfolioData;
}

function loadHistory(): HistoryPoint[] {
  const historyDir = path.join(DATA_DIR, 'positions_history');
  if (!fs.existsSync(historyDir)) return [];

  const files = glob.sync('positions_*.json', { cwd: historyDir }).sort();
  const seen = new Set<string>();
  const points: HistoryPoint[] = [];

  for (const file of files) {
    const dateMatch = file.match(/positions_(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const date = dateMatch[1];
    if (seen.has(date)) continue; // one point per day
    seen.add(date);
    try {
      const data = fs.readJsonSync(path.join(historyDir, file));
      if (data.totalNetWorth) {
        points.push({ date, value: data.totalNetWorth });
      }
    } catch { /* skip corrupt files */ }
  }
  return points;
}

function loadRecommendations(): Recommendation[] {
  const reportDirs = glob.sync('20*', { cwd: REPORTS_DIR }).sort();
  if (reportDirs.length === 0) return [];
  const latest = reportDirs[reportDirs.length - 1];
  const portfolioPath = path.join(REPORTS_DIR, latest, 'portfolio.md');
  if (!fs.existsSync(portfolioPath)) return [];

  const content = fs.readFileSync(portfolioPath, 'utf-8');
  const recs: Recommendation[] = [];
  const seen = new Set<string>();

  // Parse all table rows line by line
  const lines = content.split('\n');
  for (const line of lines) {
    // Match: | # | Name | Account | Value | ... | **RATING** | ... |
    const m = line.match(/^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([\d,.]+)\s*\|(.+)\|/);
    if (!m) continue;
    const ratingMatch = line.match(/\*\*(\w+)\*\*/);
    if (!ratingMatch) continue;

    const name = m[1].trim();
    if (seen.has(name)) continue;
    seen.add(name);

    const account = m[2].trim();
    const value = parseFloat(m[3].replace(/,/g, ''));
    const rating = ratingMatch[1].trim();

    // Extract P&L (looks like +34.8% or -3.8% or 0.0%)
    const pnlMatch = line.match(/\|\s*([+-]?[\d.]+%)\s*\|/);
    const pnl = pnlMatch ? pnlMatch[1] : '';

    // Extract action: last column after the rating
    const afterRating = line.split(/\*\*\w+\*\*/)[1] || '';
    const actionCols = afterRating.split('|').map(s => s.trim()).filter(Boolean);
    // For equities: Price Target | Total Return; for funds: Action
    const action = actionCols.length >= 2
      ? `Target: ${actionCols[0]}, Return: ${actionCols[1]}`
      : actionCols[0] || '';

    recs.push({ symbol: '', name, rating, value, pnl, action, account });
  }

  return recs;
}

function loadOpportunities(): Opportunity[] {
  const reportDirs = glob.sync('20*', { cwd: REPORTS_DIR }).sort();
  if (reportDirs.length === 0) return [];
  const latest = reportDirs[reportDirs.length - 1];
  const oppPath = path.join(REPORTS_DIR, latest, 'NEW_OPPORTUNITIES.md');
  if (!fs.existsSync(oppPath)) return [];

  const content = fs.readFileSync(oppPath, 'utf-8');
  const opportunities: Opportunity[] = [];

  // Split by ## Opportunity N:
  const sections = content.split(/## Opportunity \d+:\s*/);
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const nameMatch = section.match(/^(.+?)$/m);
    const isinMatch = section.match(/\*\*ISIN\*\*\s*\|\s*(\S+)/);
    const allocMatch = section.match(/\*\*Allocation\*\*\s*\|\s*(.+?)(?:\s*\|)/);
    const confMatch = section.match(/\*\*Confidence\*\*\s*\|\s*(\S+)/);
    const prioMatch = section.match(/\*\*Priority\*\*\s*\|\s*(\d+)/);
    const ratMatch = section.match(/\*\*Rationale\*\*:\s*(.+?)(?:\n\n|\n\*\*)/s);

    opportunities.push({
      name: nameMatch?.[1]?.trim() || `Opportunity ${i}`,
      isin: isinMatch?.[1] || '',
      allocation: allocMatch?.[1]?.trim() || '',
      confidence: confMatch?.[1] || '',
      priority: parseInt(prioMatch?.[1] || `${i}`),
      rationale: ratMatch?.[1]?.trim() || '',
    });
  }

  return opportunities;
}

function loadRecentActivity(): LedgerEntry[] {
  const ledgerPath = path.join(DATA_DIR, 'ledger.json');
  if (!fs.existsSync(ledgerPath)) return [];
  try {
    const data = fs.readJsonSync(ledgerPath);
    const entries = data.entries || [];
    return entries.slice(-10).reverse();
  } catch { return []; }
}

function getAllPositions(data: PortfolioData): Position[] {
  const pos = data.positions;
  const all: Position[] = [
    ...pos.equities,
    ...pos.funds,
    ...(pos.bonds || []),
    ...(pos.private_equity || []),
    ...(pos.private_debt || []),
    ...(pos.real_estate || []),
    ...(pos.crowdfunding || []),
  ];
  // Add crypto as Position-like
  if (pos.crypto) {
    for (const c of pos.crypto) {
      all.push({
        symbol: c.symbol,
        name: c.name,
        shares: c.balance,
        currentPrice: c.currentPrice,
        marketValue: c.marketValue,
        costBasis: (c as any).costBasis || c.marketValue,
        unrealizedGainLoss: (c as any).unrealizedGainLoss || 0,
        account: (c as any).account || c.chain,
        sector: 'Crypto',
        currency: 'EUR',
      });
    }
  }
  // Add cash
  if (pos.cash) {
    for (const c of pos.cash) {
      all.push({
        symbol: c.symbol,
        name: c.name,
        shares: (c as any).balance || c.shares,
        currentPrice: 1,
        marketValue: c.marketValue,
        costBasis: c.marketValue,
        unrealizedGainLoss: 0,
        account: c.account,
        sector: 'Cash',
        currency: c.currency,
      });
    }
  }
  return all;
}

function getCategoryAllocations(data: PortfolioData): { category: string; value: number }[] {
  const pos = data.positions;
  const cats: { category: string; value: number }[] = [];

  const sumVal = (arr: any[]) => arr.reduce((s: number, p: any) => s + (p.marketValue || 0), 0);

  if (pos.equities.length) cats.push({ category: 'Equities', value: sumVal(pos.equities) });
  if (pos.funds.length) cats.push({ category: 'Funds & ETFs', value: sumVal(pos.funds) });
  if (pos.bonds?.length) cats.push({ category: 'Bonds', value: sumVal(pos.bonds) });
  if (pos.private_equity?.length) cats.push({ category: 'Private Equity', value: sumVal(pos.private_equity) });
  if (pos.private_debt?.length) cats.push({ category: 'Private Debt', value: sumVal(pos.private_debt) });
  if (pos.real_estate?.length) cats.push({ category: 'Real Estate', value: sumVal(pos.real_estate) });
  if (pos.crowdfunding?.length) cats.push({ category: 'Crowdfunding', value: sumVal(pos.crowdfunding) });
  if (pos.crypto?.length) cats.push({ category: 'Crypto', value: sumVal(pos.crypto) });
  if (pos.cash?.length) cats.push({ category: 'Cash', value: sumVal(pos.cash) });

  return cats.sort((a, b) => b.value - a.value);
}

function formatEur(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Old static generateHTML removed — replaced by generateShellHTML + /api/data

function loadAllData() {
  return {
    portfolio: loadPortfolioData(),
    history: loadHistory(),
    recommendations: loadRecommendations(),
    opportunities: loadOpportunities(),
    ledger: loadRecentActivity(),
  };
}

function buildProjection(currentValue: number): {
  years: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
} {
  // Lognormal projection: V(t) = V0 * exp((mu - sigma^2/2)*t + sigma*sqrt(t)*z)
  // Assumptions: 6% expected real return, 14% annual volatility (balanced portfolio)
  const mu = 0.06;
  const sigma = 0.14;
  const z = { p10: -1.2816, p25: -0.6745, p50: 0, p75: 0.6745, p90: 1.2816 };
  const years: number[] = [];
  const p10: number[] = [], p25: number[] = [], p50: number[] = [], p75: number[] = [], p90: number[] = [];

  for (let t = 0; t <= 15; t++) {
    years.push(new Date().getFullYear() + t);
    const drift = (mu - sigma * sigma / 2) * t;
    const vol = sigma * Math.sqrt(t);
    p10.push(Math.round(currentValue * Math.exp(drift + vol * z.p10)));
    p25.push(Math.round(currentValue * Math.exp(drift + vol * z.p25)));
    p50.push(Math.round(currentValue * Math.exp(drift + vol * z.p50)));
    p75.push(Math.round(currentValue * Math.exp(drift + vol * z.p75)));
    p90.push(Math.round(currentValue * Math.exp(drift + vol * z.p90)));
  }
  return { years, p10, p25, p50, p75, p90 };
}

function buildApiData() {
  const { portfolio, history, recommendations, opportunities, ledger } = loadAllData();
  const allPositions = portfolio ? getAllPositions(portfolio) : [];
  const investedPositions = allPositions.filter(p => p.sector !== 'Cash');
  const totalInvested = investedPositions.reduce((s, p) => s + p.costBasis, 0);
  const totalPnL = investedPositions.reduce((s, p) => s + p.unrealizedGainLoss, 0);
  const pnlPct = totalInvested > 0 ? (totalPnL / totalInvested * 100) : 0;
  const categories = portfolio ? getCategoryAllocations(portfolio) : [];
  // Build a lookup from recommendations by name (fuzzy match)
  const recByName = new Map<string, Recommendation>();
  for (const r of recommendations) {
    recByName.set(r.name.toLowerCase(), r);
  }

  const topHoldings = allPositions
    .filter(p => p.sector !== 'Cash')
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 20)
    .map((p, i) => {
      // Try to match recommendation by name substring
      let rec: Recommendation | undefined;
      for (const [key, r] of recByName) {
        if (p.name.toLowerCase().includes(key.split('(')[0].trim()) ||
            key.includes(p.name.toLowerCase().split('(')[0].trim())) {
          rec = r;
          break;
        }
      }
      return {
        rank: i + 1,
        name: p.name,
        symbol: p.symbol,
        marketValue: p.marketValue,
        pnlPct: p.costBasis > 0 ? (p.unrealizedGainLoss / p.costBasis * 100) : 0,
        weight: portfolio?.totalNetWorth ? (p.marketValue / portfolio.totalNetWorth * 100) : 0,
        rating: rec?.rating || '',
        action: rec?.action || '',
      };
    });
  const accounts = portfolio?.accounts?.filter((a: any) => a.display !== false) || [];
  const topHoldingPct = topHoldings.length > 0 && portfolio?.totalNetWorth
    ? (topHoldings[0].marketValue / portfolio.totalNetWorth * 100) : 0;
  const lastUpdated = portfolio?.lastUpdated || '';
  const dataAge = lastUpdated ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24)) : -1;

  return {
    totalNetWorth: portfolio?.totalNetWorth || 0,
    totalPnL,
    pnlPct,
    positionCount: investedPositions.length,
    topHoldingPct,
    dataAge,
    accountCount: accounts.length,
    lastUpdated,
    categories,
    topHoldings,
    accounts: accounts
      .map((a: any) => ({ name: a.name, value: a.valuation || a.balance || 0, diffPercent: a.diff_percent }))
      .sort((a: any, b: any) => Math.abs(b.value) - Math.abs(a.value)),
    actionableRecs: recommendations.filter(r => r.rating === 'BUY' || r.rating === 'SELL'),
    opportunities,
    projection: buildProjection(portfolio?.totalNetWorth || 0),
    ledger: ledger.map(e => ({
      date: e.timestamp,
      phase: e.phase,
      status: e.status,
    })),
  };
}

function generateShellHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Family Office Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0e17;--card:#0f1419;--border:#1a1f2e;--border-hover:#2a3040;
  --text:#c8d0dc;--text-muted:#7a8599;--text-dim:#4a5568;
  --accent:#3b82f6;--accent-cyan:#06b6d4;
  --positive:#22c55e;--negative:#ef4444;--warning:#eab308;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;overflow:hidden}
.terminal{display:grid;grid-template-columns:200px 1fr 1fr 1fr;grid-template-rows:28px 140px 1fr 1fr;gap:1px;height:100vh;background:var(--border)}
.terminal>*{background:var(--bg);padding:6px 10px}
.bar{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;background:#0d1117;padding:0 12px;font-size:10px}
.bar h1{font-size:11px;font-weight:600;color:var(--accent);letter-spacing:3px;text-transform:uppercase}
.bar-right{display:flex;align-items:center;gap:14px}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--positive);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
.pnl{font-size:10px;margin-top:4px}
.positive{color:var(--positive)}.negative{color:var(--negative)}
.lbl{font-size:9px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;font-weight:600}
/* Col 1: summary stack */
.summary{grid-row:2/5;display:flex;flex-direction:column;gap:1px;padding:0;background:var(--border)}
.summary>div{background:var(--bg);padding:8px 10px}
.summary .activity-panel{flex:1;background:var(--bg);padding:8px 10px;overflow-y:auto}
.sync-ts{font-size:9px;color:var(--text-dim);text-align:center;padding:6px 10px;background:var(--bg)}
.nw-val{font-size:22px;font-weight:700;color:#fff;line-height:1.1}
.nw-eur{font-size:11px;color:var(--text-dim)}
.stat-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.stat-row:last-child{border:none}
.stat-label{color:var(--text-dim)}
.stat-val{color:var(--text);font-weight:500}
.account-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.account-row:last-child{border:none}
.account-name{color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.account-val{color:var(--text);text-align:right;flex-shrink:0;min-width:70px}
.account-diff{color:var(--text-dim);min-width:40px;text-align:right;flex-shrink:0;margin-left:4px}
/* Row 2: charts */
.alloc-panel{overflow:hidden}
.alloc-wrap{height:calc(100% - 20px);position:relative}
.hist-panel{grid-column:3/5;overflow:hidden}
.bottom{grid-column:2/5}
.hist-wrap{height:calc(100% - 20px);position:relative}
.holdings{grid-column:2/5;overflow-y:auto;overflow-x:hidden;padding:0}
.holdings table{width:100%;border-collapse:collapse}
.holdings th{font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--bg);position:sticky;top:0;z-index:2}
.holdings th.num,.holdings td.num{text-align:right}
.holdings td{padding:3px 8px;border-bottom:1px solid rgba(255,255,255,.02);font-size:10px}
.holdings td.rank{color:var(--text-dim);width:18px}
.holdings .h-name{font-weight:500;color:var(--text)}
.holdings .h-sym{color:var(--text-dim);font-size:9px}
.holdings td.num{font-size:10px}
.holdings tr:hover{background:rgba(255,255,255,.02)}
.holdings td.act{text-align:center;width:50px}
.rbadge{font-size:8px;font-weight:700;letter-spacing:.3px;padding:1px 5px;border-radius:2px;cursor:default}
.rbadge.buy{background:rgba(34,197,94,.15);color:var(--positive)}
.rbadge.sell{background:rgba(239,68,68,.15);color:var(--negative)}
.rbadge.hold{background:rgba(100,116,139,.1);color:var(--text-dim)}
/* Bottom panels */
.bottom{grid-column:2/5;display:grid;grid-template-columns:1fr 1fr;gap:1px;padding:0;background:var(--border)}
.bottom>div{background:var(--bg);padding:6px 10px;overflow-y:auto}
.rec-row{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.02)}
.rec-row:last-child{border:none}
.rec-badge{font-size:8px;font-weight:700;padding:1px 5px;border-radius:2px;flex-shrink:0}
.rec-row.buy .rec-badge{background:rgba(34,197,94,.15);color:var(--positive)}
.rec-row.sell .rec-badge{background:rgba(239,68,68,.15);color:var(--negative)}
.rec-name{font-size:10px;color:var(--text)}
.rec-detail{font-size:9px;color:var(--text-dim)}
.rec-action{font-size:9px;color:var(--accent-cyan)}
.opp-row{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.02)}
.opp-row:last-child{border:none}
.opp-header{display:flex;gap:4px;margin-bottom:2px}
.opp-prio{font-size:8px;font-weight:700;color:var(--accent)}
.opp-conf{font-size:8px;font-weight:600}
.opp-conf.high{color:var(--positive)}
.opp-conf.medium{color:var(--warning)}
.opp-name{font-size:10px;color:var(--text)}
.opp-isin{font-size:9px;color:var(--accent-cyan)}
.opp-alloc{font-size:9px;color:var(--text-dim)}
.opp-rationale{font-size:9px;color:var(--text-dim);line-height:1.3}
.ledger-row{display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.02);font-size:10px}
.ledger-row:last-child{border:none}
.ledger-date{color:var(--text-dim);min-width:42px}
.ledger-phase{flex:1;color:var(--text-muted);text-transform:capitalize}
.ledger-status{font-size:9px;font-weight:600;text-transform:uppercase}
.empty-state{color:var(--text-dim);font-size:10px;padding:8px 0;text-align:center}
[data-tooltip]{position:relative}
[data-tooltip]:hover::after{content:attr(data-tooltip);position:absolute;bottom:calc(100% + 4px);right:0;background:#1a1f2e;color:var(--text);font-size:9px;padding:4px 8px;border-radius:3px;white-space:nowrap;border:1px solid #2a3040;z-index:100;pointer-events:none}
</style>
</head>
<body>
<div class="terminal">
  <div class="bar">
    <h1>Family Office</h1>
    <div class="bar-right"></div>
  </div>

  <div class="summary">
    <div>
      <div class="lbl">Net Worth</div>
      <div class="nw-val" id="nwValue"></div>
      <div class="pnl" id="nwPnl"></div>
    </div>
    <div>
      <div class="lbl">Health</div>
      <div class="stat-row"><span class="stat-label">Positions</span><span class="stat-val" id="hPositions">-</span></div>
      <div class="stat-row"><span class="stat-label">Top Holding</span><span class="stat-val" id="hTopHolding">-</span></div>
      <div class="stat-row"><span class="stat-label">Data Age</span><span class="stat-val" id="hDataAge">-</span></div>
      <div class="stat-row"><span class="stat-label">Accounts</span><span class="stat-val" id="hAccounts">-</span></div>
    </div>
    <div>
      <div class="lbl">Accounts</div>
      <div id="accountsContainer"></div>
    </div>
    <div class="activity-panel">
      <div class="lbl">Recent Activity</div>
      <div id="ledgerContainer"></div>
    </div>
    <div class="sync-ts"><div class="live-dot" style="display:inline-block;vertical-align:middle;margin-right:4px"></div><span id="lastUpdatedText"></span></div>
  </div>

  <div class="alloc-panel">
    <div class="lbl">Allocation</div>
    <div class="alloc-wrap"><canvas id="allocationChart"></canvas></div>
  </div>

  <div class="hist-panel">
    <div class="lbl">15Y Projection</div>
    <div class="hist-wrap"><canvas id="historyChart"></canvas></div>
  </div>

  <div class="holdings">
    <table>
      <thead><tr><th></th><th>Position</th><th class="num">Value</th><th class="num">P&L</th><th class="num">Wt%</th><th class="act">Act</th></tr></thead>
      <tbody id="holdingsBody"></tbody>
    </table>
  </div>

  <div class="bottom">
    <div>
      <div class="lbl">Action Items</div>
      <div id="actionsContainer"></div>
    </div>
    <div>
      <div class="lbl">New Opportunities</div>
      <div id="oppsContainer"></div>
    </div>
  </div>
</div>

<script>
var COLORS = ['#3b82f6','#06b6d4','#10b981','#f59e0b','#8b5cf6','#ec4899','#f97316','#14b8a6','#6366f1'];
var allocChart = null, histChart = null;

function fmt(n) { return Math.round(n).toLocaleString('fr-FR'); }

function render(d) {
  document.getElementById('nwValue').innerHTML = fmt(d.totalNetWorth) + ' <span class="nw-eur">EUR</span>';
  var pnlEl = document.getElementById('nwPnl');
  pnlEl.className = 'pnl ' + (d.totalPnL >= 0 ? 'positive' : 'negative');
  pnlEl.textContent = (d.totalPnL >= 0 ? '+' : '') + fmt(d.totalPnL) + ' (' + (d.pnlPct >= 0 ? '+' : '') + d.pnlPct.toFixed(1) + '%)';

  document.getElementById('lastUpdatedText').textContent = d.lastUpdated ? 'Last sync ' + new Date(d.lastUpdated).toLocaleString('fr-FR') : '--';

  document.getElementById('hPositions').textContent = d.positionCount;
  var topEl = document.getElementById('hTopHolding');
  topEl.textContent = d.topHoldingPct.toFixed(1) + '%';
  topEl.className = 'stat-val' + (d.topHoldingPct > 15 ? ' negative' : '');
  var ageEl = document.getElementById('hDataAge');
  ageEl.textContent = d.dataAge >= 0 ? d.dataAge + 'd' : '--';
  ageEl.className = 'stat-val ' + (d.dataAge > 3 ? 'negative' : 'positive');
  document.getElementById('hAccounts').textContent = d.accountCount;

  document.getElementById('holdingsBody').innerHTML = d.topHoldings.map(function(p) {
    var cls = p.pnlPct >= 0 ? 'positive' : 'negative';
    var act = '';
    if (p.rating) {
      var tt = p.action || p.rating;
      act = '<span class="rbadge ' + p.rating.toLowerCase() + '" data-tooltip="' + tt.replace(/"/g,'&quot;') + '">' + p.rating + '</span>';
    }
    return '<tr><td class="rank">' + p.rank + '</td>' +
      '<td><span class="h-name">' + p.name + '</span> <span class="h-sym">' + p.symbol + '</span></td>' +
      '<td class="num">' + fmt(p.marketValue) + '</td>' +
      '<td class="num ' + cls + '">' + (p.pnlPct >= 0 ? '+' : '') + p.pnlPct.toFixed(1) + '%</td>' +
      '<td class="num">' + p.weight.toFixed(1) + '</td>' +
      '<td class="act">' + act + '</td></tr>';
  }).join('');

  // Action items (BUY + SELL)
  var actEl = document.getElementById('actionsContainer');
  var recs = d.actionableRecs || [];
  actEl.innerHTML = recs.length > 0 ? recs.map(function(r) {
    var isBuy = r.rating === 'BUY';
    var cls = isBuy ? 'buy' : 'sell';
    return '<div class="rec-row ' + cls + '"><div class="rec-badge">' + r.rating + '</div><div class="rec-info"><div class="rec-name">' + r.name + '</div><div class="rec-detail">' + fmt(r.value) + ' EUR' + (r.pnl ? ' | ' + r.pnl : '') + ' | ' + (r.account || '') + '</div>' + (r.action ? '<div class="rec-action">' + r.action + '</div>' : '') + '</div></div>';
  }).join('') : '<div class="empty-state">No action items</div>';

  // Opportunities
  var oppsEl = document.getElementById('oppsContainer');
  oppsEl.innerHTML = d.opportunities.length > 0 ? d.opportunities.map(function(o) {
    var rat = o.rationale || '';
    return '<div class="opp-row"><div class="opp-header"><span class="opp-prio">P' + o.priority + '</span><span class="opp-conf ' + (o.confidence||'').toLowerCase() + '">' + o.confidence + '</span></div><div class="opp-name">' + o.name + '</div><div class="opp-isin">' + o.isin + '</div><div class="opp-alloc">' + o.allocation + '</div><div class="opp-rationale">' + rat.substring(0,120) + (rat.length > 120 ? '...' : '') + '</div></div>';
  }).join('') : '<div class="empty-state">No opportunities discovered</div>';

  // Accounts
  var acctEl = document.getElementById('accountsContainer');
  acctEl.innerHTML = d.accounts.map(function(a) {
    var diff = a.diffPercent;
    var diffStr = diff != null ? '<span class="' + (diff >= 0 ? 'positive' : 'negative') + '">' + (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + '%</span>' : '';
    return '<div class="account-row"><span class="account-name">' + a.name + '</span><span class="account-val">' + fmt(a.value) + ' \u20ac</span><span class="account-diff">' + diffStr + '</span></div>';
  }).join('');

  // Ledger
  var ledgEl = document.getElementById('ledgerContainer');
  ledgEl.innerHTML = d.ledger.length > 0 ? d.ledger.map(function(e) {
    var date = e.date ? new Date(e.date).toLocaleDateString('fr-FR', {day:'2-digit',month:'short'}) : '';
    var cls = e.status === 'completed' ? 'positive' : 'negative';
    return '<div class="ledger-row"><span class="ledger-date">' + date + '</span><span class="ledger-phase">' + (e.phase||'').replace('_',' ') + '</span><span class="ledger-status ' + cls + '">' + e.status + '</span></div>';
  }).join('') : '<div class="empty-state">No recent activity</div>';

  // Allocation donut — create once, update data on refresh
  if (d.categories.length > 0) {
    var labels = d.categories.map(function(c){return c.category});
    var values = d.categories.map(function(c){return c.value});
    if (allocChart) {
      allocChart.data.labels = labels;
      allocChart.data.datasets[0].data = values;
      allocChart.data.datasets[0].backgroundColor = COLORS.slice(0,d.categories.length);
      allocChart.update('none');
    } else {
      var ctx = document.getElementById('allocationChart').getContext('2d');
      allocChart = new Chart(ctx, {
        type:'doughnut',
        data:{labels:labels,datasets:[{data:values,backgroundColor:COLORS.slice(0,d.categories.length),borderWidth:0,hoverOffset:0}]},
        options:{animation:false,responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:'right',labels:{color:'#7a8599',font:{size:8,family:'JetBrains Mono'},padding:3,usePointStyle:true,pointStyleWidth:5,boxWidth:5}},tooltip:{backgroundColor:'#1a1f2e',titleColor:'#c8d0dc',bodyColor:'#7a8599',borderColor:'#2a3040',borderWidth:1,titleFont:{size:9},bodyFont:{size:9},callbacks:{label:function(ctx){var v=ctx.raw;var t=ctx.dataset.data.reduce(function(a,b){return a+b},0);return ' '+ctx.label+': '+Math.round(v).toLocaleString()+' \u20ac ('+(v/t*100).toFixed(1)+'%)'}}}}}
      });
    }
  }

  // Projection fan chart — create once, update data on refresh
  if (d.projection && d.projection.years.length > 0) {
    var pj = d.projection;
    if (histChart) {
      histChart.data.labels = pj.years;
      histChart.data.datasets[0].data = pj.p10;
      histChart.data.datasets[1].data = pj.p25;
      histChart.data.datasets[2].data = pj.p50;
      histChart.data.datasets[3].data = pj.p75;
      histChart.data.datasets[4].data = pj.p90;
      histChart.update('none');
    } else {
      var ctx2 = document.getElementById('historyChart').getContext('2d');
      histChart = new Chart(ctx2, {
        type:'line',
        data:{labels:pj.years,datasets:[
          {label:'P10',data:pj.p10,borderColor:'transparent',backgroundColor:'rgba(59,130,246,0.06)',fill:'+4',pointRadius:0,tension:0.3},
          {label:'P25',data:pj.p25,borderColor:'transparent',backgroundColor:'rgba(59,130,246,0.1)',fill:'+2',pointRadius:0,tension:0.3},
          {label:'Median',data:pj.p50,borderColor:'#3b82f6',borderWidth:1.5,backgroundColor:'transparent',fill:false,pointRadius:0,tension:0.3,borderDash:[]},
          {label:'P75',data:pj.p75,borderColor:'transparent',backgroundColor:'rgba(59,130,246,0.1)',fill:'-2',pointRadius:0,tension:0.3},
          {label:'P90',data:pj.p90,borderColor:'transparent',backgroundColor:'rgba(59,130,246,0.06)',fill:'-4',pointRadius:0,tension:0.3}
        ]},
        plugins:[{id:'endLabels',afterDraw:function(chart){var ctx=chart.ctx;ctx.font='9px JetBrains Mono';var meta,last,y,labels=[{idx:0,color:'#4a5568',label:'P10'},{idx:2,color:'#3b82f6',label:'Med'},{idx:4,color:'#4a5568',label:'P90'}];for(var i=0;i<labels.length;i++){meta=chart.getDatasetMeta(labels[i].idx);if(!meta.data.length)continue;last=meta.data[meta.data.length-1];y=last.y;ctx.fillStyle=labels[i].color;var val=Math.round(chart.data.datasets[labels[i].idx].data[chart.data.datasets[labels[i].idx].data.length-1]/1000)+'k';ctx.fillText(labels[i].label+' '+val,last.x+6,y+3)}}}],
        options:{animation:false,responsive:true,maintainAspectRatio:false,layout:{padding:{right:55}},
          scales:{x:{grid:{display:false},ticks:{color:'#4a5568',font:{size:8,family:'JetBrains Mono'},maxTicksLimit:8}},y:{beginAtZero:false,min:Math.min.apply(null,pj.p10)*0.9,grid:{color:'rgba(255,255,255,0.02)'},ticks:{color:'#4a5568',font:{size:8,family:'JetBrains Mono'},callback:function(v){return Math.round(v/1000)+'k'}}}},
          plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,backgroundColor:'#1a1f2e',titleColor:'#c8d0dc',bodyColor:'#7a8599',borderColor:'#2a3040',borderWidth:1,titleFont:{size:9},bodyFont:{size:9},
            callbacks:{label:function(ctx){var l=ctx.dataset.label;if(l==='Median')return 'Median: '+Math.round(ctx.raw).toLocaleString()+' \u20ac';if(l==='P10')return 'Bear (P10): '+Math.round(ctx.raw).toLocaleString()+' \u20ac';if(l==='P90')return 'Bull (P90): '+Math.round(ctx.raw).toLocaleString()+' \u20ac';return ''}},
            filter:function(item){return item.dataset.label==='Median'||item.dataset.label==='P10'||item.dataset.label==='P90'}
          }}
        }
      });
    }
  }
}

function refresh() {
  fetch('/api/data').then(function(r){return r.json()}).then(render).catch(function(e){console.error('Refresh failed:',e)});
}

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const PORT = parseInt(process.env.DASHBOARD_PORT || '3000', 10);

  const server = http.createServer((req, res) => {
    if (req.url === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildApiData()));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(generateShellHTML());
    }
  });

  server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
    console.log('Live-refreshing every 30s. Press Ctrl+C to stop.');
    const open = require('open');
    open(`http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Dashboard error:', err);
  process.exit(1);
});
