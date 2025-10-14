#!/usr/bin/env node
// @ts-nocheck

import path from 'path';
import fs from 'fs-extra';
import React, {useMemo} from 'react';
import {render, Box, Text} from 'ink';
import {Command} from 'commander';
import {PortfolioData} from './types';

const categoryEmojis: Record<string, string> = {
  equities: '📈',
  funds: '📊',
  bonds: '💵',
  cash: '💰',
  private_equity: '🤝',
  private_debt: '📘',
  real_estate: '🏠',
  crowdfunding: '🌱',
  crypto: '🪙'
};

const formatCategoryLabel = (category: string): string => {
  return category
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatCurrency = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch (error) {
    // Fallback if the provided currency code is invalid
    return `${currency} ${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
};

const calculateCategoryTotal = (positions: any[]): number => {
  if (!Array.isArray(positions)) {
    return 0;
  }

  return positions.reduce((sum, position) => {
    const value = typeof position?.marketValue === 'number' ? position.marketValue : 0;
    return sum + value;
  }, 0);
};

const calculateNetWorth = (data: PortfolioData | null | undefined): { value: number; source: string } => {
  if (!data) {
    return { value: 0, source: 'No data available' };
  }

  if (typeof data.totalNetWorth === 'number' && !Number.isNaN(data.totalNetWorth)) {
    return {
      value: data.totalNetWorth,
      source: 'Provided by positions.json'
    };
  }

  if (data.positions) {
    const total = Object.values(data.positions).reduce((sum, positions) => {
      return sum + calculateCategoryTotal(positions as any[]);
    }, 0);

    return {
      value: total,
      source: 'Calculated from position market values'
    };
  }

  return { value: 0, source: 'No positions available' };
};

const PositionRow: React.FC<{
  symbol: string;
  name: string;
  marketValue: number;
  shares?: number;
  currency: string;
}> = ({symbol, name, marketValue, shares, currency}) => {
  const leftLabel = symbol ? `${symbol} — ${name}` : name;
  const shareLabel = typeof shares === 'number' && shares !== 0 ? ` (${shares.toLocaleString('en-US')} units)` : '';

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text>{leftLabel}{shareLabel}</Text>
      <Text color="green">{formatCurrency(marketValue, currency)}</Text>
    </Box>
  );
};

const CategorySection: React.FC<{
  category: string;
  positions: any[];
  currency: string;
}> = ({category, positions, currency}) => {
  if (!positions || positions.length === 0) {
    return null;
  }

  const categoryTotal = calculateCategoryTotal(positions);
  const emoji = categoryEmojis[category] ?? '•';
  const title = `${emoji} ${formatCategoryLabel(category)} — ${positions.length} position${positions.length === 1 ? '' : 's'}`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{title}</Text>
      <Text color="cyan">Total: {formatCurrency(categoryTotal, currency)}</Text>
      <Box flexDirection="column" marginTop={1}>
        {positions.map((position, index) => (
          <PositionRow
            key={`${category}-${position.symbol ?? position.name ?? index}`}
            symbol={position.symbol ?? ''}
            name={position.name ?? ''}
            marketValue={typeof position.marketValue === 'number' ? position.marketValue : 0}
            shares={typeof position.shares === 'number' ? position.shares : undefined}
            currency={currency}
          />
        ))}
      </Box>
    </Box>
  );
};

const PortfolioApp: React.FC<{
  data: PortfolioData | null;
  error?: string;
  source: string;
  currency: string;
}> = ({data, error, source, currency}) => {
  const {value: netWorth, source: netWorthSource} = useMemo(() => calculateNetWorth(data), [data]);

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text>Source: {source}</Text>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No portfolio data available.</Text>
        <Text>Expected data file at: {source}</Text>
      </Box>
    );
  }

  const lastUpdated = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'Unknown';
  const categories = Object.entries(data.positions ?? {});

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="cyan" bold>
          Family Office Portfolio Snapshot
        </Text>
        <Text>Source: {source}</Text>
        <Text>Last Updated: {lastUpdated}</Text>
        <Text color="green">Total Net Worth: {formatCurrency(netWorth, currency)}</Text>
        <Text dimColor>Net worth source: {netWorthSource}</Text>
      </Box>

      {categories.length === 0 ? (
        <Text color="yellow">No positions found in the data file.</Text>
      ) : (
        categories.map(([category, positions]) => (
          <CategorySection key={category} category={category} positions={positions as any[]} currency={currency} />
        ))
      )}
    </Box>
  );
};

const program = new Command();

program
  .name('portfolio-cli')
  .description('Interactive CLI portfolio tracker built with Ink')
  .option('-f, --file <path>', 'Path to positions.json file', 'data/positions.json')
  .option('-c, --currency <code>', 'ISO currency code used when formatting values', 'EUR');

program.parse(process.argv);

const options = program.opts();

const resolvePositionsPath = (filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(process.cwd(), filePath);
};

const loadPortfolioData = async (filePath: string): Promise<PortfolioData | null> => {
  try {
    const exists = await fs.pathExists(filePath);

    if (!exists) {
      return null;
    }

    const data = await fs.readJSON(filePath);
    return data as PortfolioData;
  } catch (error: any) {
    throw new Error(`Unable to read positions file: ${error.message ?? error}`);
  }
};

(async () => {
  const positionsPath = resolvePositionsPath(options.file);
  let data: PortfolioData | null = null;
  let error: string | undefined;

  try {
    data = await loadPortfolioData(positionsPath);

    if (!data) {
      error = `Positions file not found at ${positionsPath}`;
    }
  } catch (readError: any) {
    error = readError.message ?? String(readError);
  }

  const {waitUntilExit} = render(
    <PortfolioApp data={data} error={error && data ? undefined : error} source={positionsPath} currency={options.currency} />
  );

  await waitUntilExit();
})();

