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

/**
 * 从 DeepSeek API 获取当日用量
 * @param {string} apiKey - DeepSeek API Key
 * @param {Date} date - 查询日期（默认今天）
 * @returns {Promise<{totalTokens: number, costYuan: number}>}
 */
export async function fetchDailyUsage(apiKey, date = new Date()) {
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured.');
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const response = await fetch(
    `${DEEPSEEK_API_BASE}/v1/usage?start_time=${startOfDay.toISOString()}&end_time=${endOfDay.toISOString()}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DeepSeek usage API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  return parseUsageResponse(data);
}

/**
 * 解析 /v1/usage 响应
 *
 * 响应结构待实测确认。预期包含 total_tokens 和 cost 字段。
 * 当前实现兼容多种常见格式，后续可根据实测调整。
 */
function parseUsageResponse(data) {
  let totalTokens = 0;
  let costYuan = 0;

  if (Array.isArray(data?.data)) {
    for (const item of data.data) {
      totalTokens += parseNum(item.total_tokens);
      costYuan += parseNum(item.cost_in_cents) / 100;
    }
  } else if (data?.total_tokens !== undefined) {
    totalTokens = parseNum(data.total_tokens);
    costYuan = parseNum(data.cost_in_cents) / 100;
  } else if (data?.usage) {
    totalTokens = parseNum(data.usage.total_tokens);
    costYuan = parseNum(data.usage.cost_in_cents) / 100;
  } else {
    console.error('[deepseek-quota] Unexpected usage response format:', JSON.stringify(data));
    throw new Error('Unexpected usage response format. Check stderr for raw data.');
  }

  return { totalTokens, costYuan };
}

function parseNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

/**
 * 抓取所有 DeepSeek 数据（余额 + 当日用量）
 * @param {string} apiKey
 * @returns {Promise<{balance: object, daily: object}>}
 */
export async function fetchAll(apiKey) {
  const [balance, daily] = await Promise.all([
    fetchBalance(apiKey),
    fetchDailyUsage(apiKey),
  ]);

  return { balance, daily };
}
