#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchAll } from './fetcher.js';
import { writeSnapshot, readSnapshot } from './snapshot.js';

const config = loadConfig();
let intervalId = null;

const sessionTokens = readSnapshot(config.snapshotPath) ?? {
  cache_hit: 0, cache_miss: 0, output: 0,
};

let lastResult = null;
let initialBalance = null;

function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function readLastSession() {
  try {
    const claudeJson = join(homedir(), '.claude.json');
    if (!existsSync(claudeJson)) return null;
    const data = JSON.parse(readFileSync(claudeJson, 'utf8'));
    const projects = data.projects;
    if (!projects) return null;

    let latestProject = null, latestTime = 0;
    for (const [projectPath, p] of Object.entries(projects)) {
      const modified = p.lastSessionModified || 0;
      if (modified > latestTime && p.lastModelUsage && Object.keys(p.lastModelUsage).length > 0) {
        latestTime = modified;
        latestProject = { path: projectPath, ...p };
      }
    }
    if (!latestProject) return null;

    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0, totalCost = 0;
    for (const [, usage] of Object.entries(latestProject.lastModelUsage)) {
      totalInput += usage.inputTokens || 0;
      totalOutput += usage.outputTokens || 0;
      totalCacheRead += usage.cacheReadInputTokens || 0;
      totalCacheCreation += usage.cacheCreationInputTokens || 0;
      totalCost += usage.costUSD || 0;
    }

    return {
      project: latestProject.path.replace(homedir(), '~'),
      totalTokens: totalInput + totalOutput + totalCacheRead + totalCacheCreation,
      inputTokens: totalInput, outputTokens: totalOutput,
      cacheRead: totalCacheRead, cacheCreation: totalCacheCreation,
      costUSD: totalCost,
    };
  } catch { return null; }
}

function formatOutput(balance, delta) {
  const lines = [];
  lines.push('═══════════════════════════════');
  lines.push('  DeepSeek 用量');
  lines.push('═══════════════════════════════');
  lines.push('');
  lines.push(`💰 账户余额: ¥${balance.totalBalance.toFixed(2)}`);

  if (delta !== null && delta !== undefined) {
    const sign = delta >= 0 ? '+' : '';
    lines.push(`📉 上次查询以来: ${sign}¥${delta.toFixed(4)}`);

    if (initialBalance !== null) {
      const totalDelta = initialBalance - balance.totalBalance;
      lines.push(`🔥 本次会话累计: ¥${totalDelta.toFixed(4)}`);
    }
  }

  lines.push(`   充值: ¥${balance.toppedUpBalance.toFixed(2)}  赠送: ¥${balance.grantedBalance.toFixed(2)}`);

  // 读取上次 session token 统计
  const lastSession = readLastSession();
  if (lastSession) {
    const f = (n) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : (n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));
    lines.push('');
    lines.push(`📊 上次会话 (${lastSession.project})`);
    lines.push(`   Token: ${lastSession.totalTokens.toLocaleString()} (入 ${f(lastSession.inputTokens)} | 出 ${f(lastSession.outputTokens)})`);
    lines.push(`   缓存命中: ${f(lastSession.cacheRead)}  缓存写入: ${f(lastSession.cacheCreation)}`);
    lines.push(`   费用: $${lastSession.costUSD.toFixed(4)}`);
  }

  lines.push('');
  lines.push('💡 定价 (V4-Pro)');
  lines.push('   缓存命中: ¥0.025/M | 未命中: ¥3.0/M | 输出: ¥6.0/M');
  lines.push('');

  return lines.join('\n');
}

async function refreshQuota() {
  try {
    const { balance, daily } = await fetchAll(config.apiKey);

    // 记录初始余额用于会话累计计算
    if (initialBalance === null) {
      initialBalance = balance.totalBalance;
    }

    const previousBalance = lastResult?.success ? lastResult.balance.totalBalance : null;
    const delta = previousBalance !== null ? balance.totalBalance - previousBalance : null;

    writeSnapshot(
      config.snapshotPath, balance, daily,
      sessionTokens, config.pricing, config.sessionBudgetTokens,
    );

    lastResult = { success: true, balance, daily, delta };
    return lastResult;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function startRefreshLoop() {
  intervalId = setInterval(() => {
    refreshQuota().then((result) => {
      if (result.success) {
        console.error(`[deepseek-quota] 余额: ¥${result.balance.totalBalance.toFixed(2)}`);
      } else {
        console.error(`[deepseek-quota] 刷新失败: ${result.error}`);
      }
    });
  }, config.refreshInterval);
}

function stopRefreshLoop() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

const server = new Server(
  { name: 'deepseek-quota', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'deepseek',
      description: '查询 DeepSeek 账户余额和当前会话累计消耗金额',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'deepseek_refresh',
      description: '强制刷新 DeepSeek 余额数据',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === 'deepseek_refresh') {
    const result = await refreshQuota();
    if (result.success) {
      return {
        content: [{
          type: 'text',
          text: `已刷新 | 余额: ¥${result.balance.totalBalance.toFixed(2)}`,
        }],
      };
    }
    return { content: [{ type: 'text', text: `刷新失败: ${result.error}` }], isError: true };
  }

  if (name === 'deepseek') {
    const result = lastResult ?? await refreshQuota();

    if (!result || !result.success) {
      return {
        content: [{
          type: 'text',
          text: result ? `查询失败: ${result.error}` : '暂无数据，请稍后重试',
        }],
        isError: true,
      };
    }

    const { balance, delta } = result;
    return {
      content: [{
        type: 'text',
        text: formatOutput(balance, delta),
      }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

process.on('SIGINT', () => { stopRefreshLoop(); process.exit(0); });
process.on('SIGTERM', () => { stopRefreshLoop(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
await refreshQuota().then((result) => {
  if (result.success) {
    console.error(`[deepseek-quota] 启动 | 初始余额: ¥${result.balance.totalBalance.toFixed(2)}`);
  } else {
    console.error(`[deepseek-quota] 启动失败: ${result.error}`);
  }
});
startRefreshLoop();
