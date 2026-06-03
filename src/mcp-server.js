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
import { fmtNum, centerPad, padEnd, strWidth } from './utils/format.js';

const config = loadConfig();
let intervalId = null;

// sessionTokens: 用于记录从快照恢复的历史 token 累计。
// 注意：在 MCP 模式下，此值仅在启动时从快照恢复，运行过程中不会被更新，
// 因为 DeepSeek API 不提供 token 级别的用量查询接口。
// 实际的会话消耗通过 initialBalance - currentBalance（余额差值）来计算。
const sessionTokens = readSnapshot(config.snapshotPath) ?? {
  cache_hit: 0, cache_miss: 0, output: 0,
};

let lastResult = null;
let initialBalance = null;

// fmtNum is now imported from ./utils/format.js

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

function bar(n, width) {
  const filled = Math.round((Math.min(100, Math.max(0, n)) / 100) * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}
// center() replaced by centerPad() from utils/format.js (CJK-aware)
function W() { return 46; }

/**
 * 填充一行内容至表格宽度 w，基于显示宽度对齐
 * @param {string} content - 行内容（不含边框）
 * @param {number} w - 表格内宽度
 * @returns {string} 右填充至宽度 w 的字符串
 */
function fillRow(content, w) {
  return padEnd(content, w);
}

function formatOutput(balance, delta) {
  const w = W();
  const lines = [];
  const bTotal = balance.totalBalance;
  const bToppedUp = balance.toppedUpBalance;
  const bGranted = balance.grantedBalance;

  lines.push('');
  lines.push('  ╭' + '─'.repeat(w) + '╮');
  const title = '🔬  DeepSeek 用量监控';
  lines.push('  │' + fillRow(centerPad(title, w), w) + '│');
  lines.push('  ╰' + '─'.repeat(w) + '╯');
  lines.push('');

  // 余额
  const pct = Math.min(100, Math.round((bTotal / 200) * 100));
  lines.push('  💰  账户余额');
  lines.push('  ┌' + '─'.repeat(w) + '┐');
  lines.push('  │' + fillRow(centerPad(`¥ ${bTotal.toFixed(2)}`, w), w) + '│');
  lines.push('  │  ' + bar(pct, w - 6) + '  │');
  lines.push('  │' + fillRow(centerPad('剩余 ' + pct + '%', w), w) + '│');
  lines.push('  ├' + '─'.repeat(w) + '┤');
  const balanceDetail = `  充值 ¥ ${bToppedUp.toFixed(2)}    赠送 ¥ ${bGranted.toFixed(2)}`;
  lines.push('  │' + fillRow(balanceDetail, w) + '│');
  lines.push('  └' + '─'.repeat(w) + '┘');
  lines.push('');

  // 消耗追踪
  if (delta !== null && delta !== undefined && Math.abs(delta) > 0.0001) {
    lines.push('  📉  余额变化');
    lines.push('  ┌' + '─'.repeat(w) + '┐');
    const sign = delta >= 0 ? '+' : '';
    lines.push('  │' + fillRow(centerPad(`${sign}¥ ${Math.abs(delta).toFixed(4)}`, w), w) + '│');
    lines.push('  └' + '─'.repeat(w) + '┘');
    lines.push('');
  }

  if (initialBalance !== null) {
    const consumed = initialBalance - bTotal;
    if (consumed > 0.0001) {
      lines.push('  🔥  本次会话消耗');
      lines.push('  ┌' + '─'.repeat(w) + '┐');
      const cPct = initialBalance > 0 ? (consumed / initialBalance) * 100 : 0;
      lines.push('  │' + fillRow(centerPad(`¥ ${consumed.toFixed(4)}  (${cPct.toFixed(1)}%)`, w), w) + '│');
      lines.push('  │' + fillRow(centerPad(`¥ ${initialBalance.toFixed(2)}  →  ¥ ${bTotal.toFixed(2)}`, w), w) + '│');
      lines.push('  └' + '─'.repeat(w) + '┘');
      lines.push('');
    }
  }

  // 上次会话
  const lastSession = readLastSession();
  if (lastSession) {
    lines.push('  📊  上次会话');
    lines.push('  ┌' + '─'.repeat(w) + '┐');
    lines.push('  │' + fillRow(centerPad(lastSession.project, w), w) + '│');
    lines.push('  ├' + '─'.repeat(w) + '┤');
    lines.push('  │' + fillRow(`  Token 总计    ${lastSession.totalTokens.toLocaleString().padStart(14)}`, w) + '│');
    lines.push('  │' + fillRow(`  输入  ${fmtNum(lastSession.inputTokens).padStart(10)}    输出  ${fmtNum(lastSession.outputTokens).padStart(10)}`, w) + '│');
    if (lastSession.cacheRead > 0) {
      lines.push('  │' + fillRow(`  缓存命中  ${fmtNum(lastSession.cacheRead).padStart(10)}`, w) + '│');
    }
    lines.push('  │' + fillRow(`  费用  $${lastSession.costUSD.toFixed(4).padStart(18)}`, w) + '│');
    lines.push('  └' + '─'.repeat(w) + '┘');
    lines.push('');
  }

  lines.push('  💡  V4-Pro 定价');
  lines.push('  ' + '─'.repeat(w + 2));
  lines.push('  缓存命中  ¥0.025/M    未命中  ¥3.0/M    输出  ¥6.0/M');
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

    // sessionTokens 仅包含从快照恢复的历史值，不反映当前会话的实时 token 消耗
    // 实际消耗通过 initialBalance - currentBalance 计算
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

let running = false;

function startRefreshLoop() {
  async function loop() {
    if (running) return; // 防止重叠调用
    running = true;
    try {
      const result = await refreshQuota();
      if (result.success) {
        console.error(`[deepseek-quota] 余额: ¥${result.balance.totalBalance.toFixed(2)}`);
      } else {
        console.error(`[deepseek-quota] 刷新失败: ${result.error}`);
      }
    } catch (err) {
      console.error(`[deepseek-quota] 刷新异常: ${err.message}`);
    } finally {
      running = false;
    }
    intervalId = setTimeout(loop, config.refreshInterval);
  }
  loop();
}

function stopRefreshLoop() {
  if (intervalId) { clearTimeout(intervalId); intervalId = null; }
}

const server = new Server(
  { name: 'deepseek-quota', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'quota',
      description: '查询 DeepSeek 账户余额和消耗。返回格式化文本，必须原样展示，不要总结或改写。',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'quota_refresh',
      description: '强制刷新 DeepSeek 余额数据',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === 'quota_refresh') {
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

  if (name === 'quota') {
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
