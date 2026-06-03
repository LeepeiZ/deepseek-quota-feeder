#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { fetchAll } from './fetcher.js';
import { writeSnapshot, readSnapshot, calculateSessionCost, formatQuota } from './snapshot.js';

const config = loadConfig();
let intervalId = null;

// 从已有快照恢复会话 token 累计（跨 MCP 重启保留）
let sessionTokens = readSnapshot(config.snapshotPath) ?? {
  cache_hit: 0,
  cache_miss: 0,
  output: 0,
};

// 缓存最近一次成功的 fetch 结果，供 get 工具直接返回
let lastResult = null;

async function refreshQuota() {
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
    lastResult = { success: true, balance, daily, snapshot, formatted: formatQuota(balance, daily, sessionTokens, config.pricing) };
    return lastResult;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function startRefreshLoop() {
  // 定时刷新（用 stderr 输出，避免干扰 stdio transport）
  // 首次刷新已在启动时 await 完成
  intervalId = setInterval(() => {
    refreshQuota().then((result) => {
      if (result.success) {
        console.error(`[deepseek-quota] Refreshed: ${result.formatted}`);
      } else {
        console.error(`[deepseek-quota] Refresh failed: ${result.error}`);
      }
    });
  }, config.refreshInterval);
}

function stopRefreshLoop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

const server = new Server(
  {
    name: 'deepseek-quota',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'refresh_deepseek_quota',
        description: '立即刷新 DeepSeek 额度数据（余额 + 当日消耗），并写入 HUD 快照文件',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_deepseek_quota',
        description: '获取当前 DeepSeek 用量详情：会话 token 统计（缓存命中/未命中/输出）、费用、当日消耗、账户余额',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === 'refresh_deepseek_quota') {
    const result = await refreshQuota();
    if (result.success) {
      return {
        content: [
          {
            type: 'text',
            text: `DeepSeek 额度已刷新\n${result.formatted}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `刷新失败: ${result.error}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'get_deepseek_quota') {
    if (!lastResult) {
      return {
        content: [{ type: 'text', text: '暂无数据，请先调用 refresh_deepseek_quota 刷新' }],
      };
    }

    const { balance, daily } = lastResult;
    const st = sessionTokens;
    const sessionTotal = st.cache_hit + st.cache_miss + st.output;
    const cost = calculateSessionCost(st, config.pricing);

    const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

    return {
      content: [
        {
          type: 'text',
          text:
            `DeepSeek 用量详情:\n\n` +
            `会话统计:\n` +
            `  - Token: ${sessionTotal.toLocaleString()} (缓存命中 ${fmt(st.cache_hit)} | 缓存未命中 ${fmt(st.cache_miss)} | 输出 ${fmt(st.output)})\n` +
            `  - 费用: ¥${cost.toFixed(2)}\n\n` +
            `当日消耗:\n` +
            `  - Token: ${daily.totalTokens.toLocaleString()}\n` +
            `  - 费用: ¥${daily.costYuan.toFixed(2)}\n\n` +
            `账户余额:\n` +
            `  - 总余额: ¥${balance.totalBalance.toFixed(2)}\n` +
            `  - 充值余额: ¥${balance.toppedUpBalance.toFixed(2)}\n` +
            `  - 赠送余额: ¥${balance.grantedBalance.toFixed(2)}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// 处理进程终止信号
process.on('SIGINT', () => {
  stopRefreshLoop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopRefreshLoop();
  process.exit(0);
});

// 启动
const transport = new StdioServerTransport();
await server.connect(transport);
// 等待首次刷新完成，避免 get_deepseek_quota 返回空数据
await refreshQuota().then((result) => {
  if (result.success) {
    console.error(`[deepseek-quota] Initial refresh: ${result.formatted}`);
  } else {
    console.error(`[deepseek-quota] Initial refresh failed: ${result.error}`);
  }
});
startRefreshLoop();
