import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 根据 DeepSeek 数据计算 session 费用
 *
 * cost = cache_hit_tokens / 1M × cacheHitPrice
 *      + cache_miss_tokens / 1M × cacheMissPrice
 *      + output_tokens / 1M × outputPrice
 */
export function calculateSessionCost(sessionTokens, pricing) {
  if (!sessionTokens) return 0;

  const { cache_hit = 0, cache_miss = 0, output = 0 } = sessionTokens;

  const cost =
    (cache_hit / 1_000_000) * pricing.inputCacheHitPerMillion +
    (cache_miss / 1_000_000) * pricing.inputCacheMissPerMillion +
    (output / 1_000_000) * pricing.outputPerMillion;

  return Math.round(cost * 10000) / 10000; // 4 decimal places
}

/**
 * 将 DeepSeek 数据写入 claude-hud 外部快照文件
 *
 * @param {string} path - 快照文件路径
 * @param {object} balance - { totalBalance, grantedBalance, toppedUpBalance, currency }
 * @param {object} daily - { totalTokens, costYuan }
 * @param {object} sessionTokens - { cache_hit, cache_miss, output } 或 null
 * @param {object} pricing - { inputCacheHitPerMillion, inputCacheMissPerMillion, outputPerMillion, currency }
 * @param {number} sessionBudgetTokens - 会话 token 预算上限
 */
export function writeSnapshot(path, balance, daily, sessionTokens, pricing, sessionBudgetTokens) {
  // 计算会话预算使用率 (five_hour)
  const sessionTotal = sessionTokens
    ? sessionTokens.cache_hit + sessionTokens.cache_miss + sessionTokens.output
    : 0;
  const sessionPct = sessionBudgetTokens > 0
    ? Math.round((sessionTotal / sessionBudgetTokens) * 100)
    : 0;

  // seven_day: 由于 DeepSeek 不提供当日用量 API，改为余额消耗告警百分比
  // 余额越低百分比越高：低于 ¥10 时 100%，¥50 以上为 0%
  // 告警公式: max(0, (50 - balance) / 50 * 100)，即 ¥0=100%, ¥25=50%, ¥50+=0%
  const balanceWarning = balance.totalBalance > 0
    ? Math.round(Math.max(0, (50 - balance.totalBalance) / 50 * 100))
    : 100;
  const sevenDayPct = balanceWarning;

  // 计算会话费用
  const sessionCost = calculateSessionCost(sessionTokens, pricing);

  // daily 可能为 null（DeepSeek 不提供当日用量 API）
  const dailyTokens = daily?.totalTokens ?? 0;
  const dailyCost = daily?.costYuan ?? 0;

  const snapshot = {
    updated_at: new Date().toISOString(),
    five_hour: {
      used_percentage: Math.min(100, Math.max(0, sessionPct)),
      resets_at: null,
    },
    seven_day: {
      used_percentage: Math.min(100, Math.max(0, sevenDayPct)),
      resets_at: null,
    },
    _deepseek: {
      session: {
        tokens: {
          cache_hit: sessionTokens?.cache_hit ?? 0,
          cache_miss: sessionTokens?.cache_miss ?? 0,
          output: sessionTokens?.output ?? 0,
        },
        cost_yuan: sessionCost,
      },
      daily: {
        tokens_total: dailyTokens,
        cost_yuan: dailyCost,
        note: daily === null ? 'DeepSeek does not provide a public daily usage API' : undefined,
      },
      balance: {
        total_yuan: balance.totalBalance,
        granted_yuan: balance.grantedBalance,
        topped_up_yuan: balance.toppedUpBalance,
      },
      pricing: {
        input_cache_hit_per_million: pricing.inputCacheHitPerMillion,
        input_cache_miss_per_million: pricing.inputCacheMissPerMillion,
        output_per_million: pricing.outputPerMillion,
      },
    },
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2));

  return snapshot;
}

/**
 * 读取已有快照中的 session token 数据
 * 用于跨 MCP 重启保留会话累计
 */
export function readSnapshot(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    return data._deepseek?.session?.tokens ?? null;
  } catch {
    return null;
  }
}

/**
 * 格式化额度为可读字符串（用于日志输出）
 */
export function formatQuota(balance, daily, sessionTokens, pricing) {
  const sessionCost = calculateSessionCost(sessionTokens, pricing);
  const sessionTotal = sessionTokens
    ? sessionTokens.cache_hit + sessionTokens.cache_miss + sessionTokens.output
    : 0;

  const fmt = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  if (daily) {
    return `会话: ${fmt(sessionTotal)} tokens / ¥${sessionCost.toFixed(2)} | 今日: ${fmt(daily.totalTokens)} tokens / ¥${daily.costYuan.toFixed(2)} | 余额: ¥${balance.totalBalance.toFixed(2)}`;
  }
  return `会话: ${fmt(sessionTotal)} tokens / ¥${sessionCost.toFixed(2)} | 余额: ¥${balance.totalBalance.toFixed(2)} (赠送 ¥${balance.grantedBalance.toFixed(2)} | 充值 ¥${balance.toppedUpBalance.toFixed(2)})`;
}
