const DEEPSEEK_API_BASE = 'https://api.deepseek.com';

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = 10_000;

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 重试基础间隔（毫秒），按指数递增：1s → 2s → 4s */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * 带超时的 fetch 封装
 * @param {string} url
 * @param {object} options - fetch options
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 判断错误是否可重试
 * - 网络错误 (TypeError / AbortError) → 可重试
 * - 5xx 状态码 → 可重试
 * - 4xx 状态码 → 不可重试
 */
function isRetryable(err) {
  // AbortError (timeout) 或网络层错误
  if (err.name === 'AbortError' || err.name === 'TypeError') return true;
  // 自定义属性标记 5xx
  if (err.statusCode && err.statusCode >= 500) return true;
  return false;
}

/**
 * 从 DeepSeek API 获取账户余额（带超时和重试）
 *
 * 重试策略：指数退避，最多 3 次，间隔 1s → 2s → 4s。
 * 仅对网络错误和 5xx 状态码重试，4xx 错误直接抛出。
 *
 * @param {string} apiKey - DeepSeek API Key
 * @returns {Promise<{totalBalance: number, grantedBalance: number, toppedUpBalance: number, currency: string}>}
 */
export async function fetchBalance(apiKey) {
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured. Set it in ~/.deepseek-quota/.token or DEEPSEEK_API_KEY env var.');
  }

  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `${DEEPSEEK_API_BASE}/user/balance`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error(`DeepSeek balance API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
        err.statusCode = response.status;

        // 4xx 错误不重试
        if (response.status >= 400 && response.status < 500) {
          throw err;
        }
        // 5xx 错误标记后抛出，由外层 catch 处理重试
        throw err;
      }

      const data = await response.json();
      return parseBalanceResponse(data);
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt >= MAX_RETRIES - 1) {
        throw err;
      }

      // 指数退避等待
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
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
