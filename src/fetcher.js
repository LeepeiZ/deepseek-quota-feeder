const DEEPSEEK_API_BASE = 'https://api.deepseek.com';

/**
 * 从 DeepSeek API 获取账户余额
 * @param {string} apiKey - DeepSeek API Key
 * @returns {Promise<{totalBalance: number, grantedBalance: number, toppedUpBalance: number, currency: string}>}
 */
export async function fetchBalance(apiKey) {
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured. Set it in ~/.deepseek-quota/.token or DEEPSEEK_API_KEY env var.');
  }

  const response = await fetch(`${DEEPSEEK_API_BASE}/user/balance`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DeepSeek balance API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  return parseBalanceResponse(data);
}

/**
 * 解析 /user/balance 响应
 *
 * {
 *   "is_available": true,
 *   "balance_infos": [
 *     {
 *       "currency": "CNY",
 *       "total_balance": "110.00",
 *       "granted_balance": "10.00",
 *       "topped_up_balance": "100.00"
 *     }
 *   ]
 * }
 */
function parseBalanceResponse(data) {
  if (!data?.is_available) {
    throw new Error('DeepSeek balance not available');
  }

  const info = data.balance_infos?.[0];
  if (!info) {
    throw new Error('No balance info in response');
  }

  return {
    totalBalance: parseNum(info.total_balance),
    grantedBalance: parseNum(info.granted_balance),
    toppedUpBalance: parseNum(info.topped_up_balance),
    currency: info.currency || 'CNY',
  };
}

function parseNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

/**
 * 抓取所有 DeepSeek 数据
 *
 * 注意：DeepSeek 目前不提供公开的当日用量 API（/v1/usage 不存在）。
 * 当日用量仅可通过 platform.deepseek.com 控制台查看。
 * 此处仅获取余额数据，daily 字段返回 null 表示不可用。
 *
 * @param {string} apiKey
 * @returns {Promise<{balance: object, daily: null}>}
 */
export async function fetchAll(apiKey) {
  const balance = await fetchBalance(apiKey);
  return { balance, daily: null };
}
