#!/usr/bin/env node

import { loadConfig } from './config.js';
import { fetchAll } from './fetcher.js';
import { writeSnapshot, readSnapshot, formatQuota } from './snapshot.js';

const config = loadConfig();
const isOnce = process.argv.includes('--once');

// 从已有快照恢复会话 token 累计
const previousTokens = readSnapshot(config.snapshotPath);
const sessionTokens = previousTokens ?? { cache_hit: 0, cache_miss: 0, output: 0 };

async function tick() {
  try {
    const { balance, daily } = await fetchAll(config.apiKey);
    const snapshot = writeSnapshot(
      config.snapshotPath,
      balance,
      daily,
      sessionTokens,
      config.pricing,
      config.sessionBudgetTokens
    );
    console.log(`[${new Date().toLocaleTimeString()}] Updated: ${formatQuota(balance, daily, sessionTokens, config.pricing)}`);

    return snapshot;
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('DeepSeek Quota Feeder');
  console.log(`Snapshot: ${config.snapshotPath}`);
  console.log(`Interval: ${config.refreshInterval}ms`);
  console.log(`Session Budget: ${config.sessionBudgetTokens.toLocaleString()} tokens`);
  console.log(`Pricing: cache_hit ¥${config.pricing.inputCacheHitPerMillion}/M | cache_miss ¥${config.pricing.inputCacheMissPerMillion}/M | output ¥${config.pricing.outputPerMillion}/M`);
  console.log('');

  if (isOnce) {
    await tick();
    return;
  }

  // 首次立即执行
  await tick();

  // 定时刷新
  setInterval(tick, config.refreshInterval);

  console.log('Running... Press Ctrl+C to stop.\n');
}

main();
