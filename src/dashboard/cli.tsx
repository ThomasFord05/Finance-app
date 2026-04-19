#!/usr/bin/env ts-node
import 'dotenv/config';
import React, { useState, useEffect } from 'react';
import { render, Text, Box, useApp, useInput } from 'ink';
import { getStats, getCronStatus } from '../db/queries';

interface StoreStats {
  activeProducts: number;
  todayOrders: number;
  lastDecision: { agent: string; action: string; reasoning: string; created_at: string } | null;
  pendingApprovals: number;
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Box borderStyle="round" borderColor={color ?? 'gray'} padding={1} marginRight={1} flexDirection="column" width={20}>
      <Text color="gray" dimColor>{label}</Text>
      <Text bold color={color ?? 'white'}>{String(value)}</Text>
    </Box>
  );
}

function Dashboard() {
  const { exit } = useApp();
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [tick, setTick] = useState(0);

  useInput((input) => {
    if (input === 'q') exit();
    if (input === 'r') setTick(t => t + 1);
  });

  useEffect(() => {
    try {
      const s = getStats();
      setStats(s as StoreStats);
    } catch {
      // DB might not be init'd in CLI mode
    }
    const interval = setInterval(() => {
      try { setStats(getStats() as StoreStats); } catch { /* */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [tick]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">⚡ Autonomous Shopify Store</Text>
        <Text color="gray"> — Press q to quit, r to refresh</Text>
      </Box>

      <Box marginBottom={1}>
        <StatBox label="Active Products" value={stats?.activeProducts ?? '—'} color="cyan" />
        <StatBox label="Today's Orders" value={stats?.todayOrders ?? '—'} color="green" />
        <StatBox label="Pending Approvals" value={stats?.pendingApprovals ?? '—'} color={stats?.pendingApprovals ? 'yellow' : 'gray'} />
      </Box>

      <Box borderStyle="round" borderColor="gray" padding={1} flexDirection="column" marginBottom={1}>
        <Text bold color="gray">Last AI Decision</Text>
        {stats?.lastDecision ? (
          <>
            <Text color="cyan">{stats.lastDecision.agent} → {stats.lastDecision.action}</Text>
            <Text color="gray" dimColor>{stats.lastDecision.reasoning?.slice(0, 80) ?? ''}</Text>
            <Text color="gray" dimColor>{stats.lastDecision.created_at}</Text>
          </>
        ) : (
          <Text color="gray" dimColor>No decisions yet</Text>
        )}
      </Box>

      <Box borderStyle="round" borderColor="gray" padding={1} flexDirection="column">
        <Text bold color="gray">Cron Jobs</Text>
        {[
          { name: 'ProductDiscovery', schedule: 'Every 72h' },
          { name: 'PricingManager', schedule: 'Every 24h' },
          { name: 'FeaturedProductsRotation', schedule: 'Weekly Sun' },
          { name: 'MarketingAgent', schedule: 'Weekly Mon' },
        ].map(j => (
          <Box key={j.name} marginTop={0}>
            <Text color="green">● </Text>
            <Text bold>{j.name}</Text>
            <Text color="gray"> ({j.schedule})</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>Dashboard: http://localhost:{process.env.PORT ?? 3000}/dashboard</Text>
      </Box>
    </Box>
  );
}

render(<Dashboard />);
