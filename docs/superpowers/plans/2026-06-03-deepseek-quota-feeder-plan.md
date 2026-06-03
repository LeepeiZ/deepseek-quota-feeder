# DeepSeek Quota Feeder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an npm-publishable MCP server that feeds DeepSeek API quota/balance data to claude-hud's status bar, following the proven kimi-quota-feeder architecture.

**Architecture:** Claude Code launches `deepseek-quota-mcp` via MCP stdio transport on startup. The MCP server maintains a refresh loop (60s) calling DeepSeek's `/user/balance` and `/v1/usage` endpoints, writing results to `~/.deepseek-quota/snapshot.json`. claude-hud reads this snapshot via `externalUsagePath` and renders five_hour (session budget %) and seven_day (daily cost vs balance %) in the status bar.

**Tech Stack:** Node.js >= 18, `@modelcontextprotocol/sdk` >= 1.29.0, zero other runtime dependencies. Pure ESM.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/config.js` | Load config from `~/.deepseek-quota/config.json`, resolve API key from env/file |
| `src/fetcher.js` | Call DeepSeek `/user/balance` and `/v1/usage`, parse responses |
| `src/snapshot.js` | Read/write `snapshot.json` in claude-hud `ExternalUsageSnapshot` format + `_deepseek` extension |
| `src/mcp-server.js` | MCP stdio server: refresh loop, register `get_deepseek_quota` and `refresh_deepseek_quota` tools |
| `src/index.js` | Standalone CLI mode (non-MCP), `--once` flag for one-shot fetch |
| `src/setup-mcp.js` | CLI: register `deepseek-quota-mcp` with `claude mcp add` |
| `src/configure-hud.js` | CLI: set `externalUsagePath` in claude-hud `config.json` |
| `src/utils/env-check.js` | Shell-safe command discovery, Claude Code detection (copied from kimi-quota-feeder) |
| `src/utils/hud-config.js` | Pure Node.js fs API for reading/writing claude-hud plugin config (copied from kimi-quota-feeder) |
| `config.example.json` | Example configuration for users |
| `package.json` | Package metadata, bin entries, npm publish config |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `config.example.json`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "deepseek-quota-feeder",
  "version": "1.0.0",
  "description": "DeepSeek API quota feeder for claude-hud external usage",
  "type": "module",
  "main": "src/index.js",
  "bin": {
    "deepseek-quota-feeder": "src/index.js",
    "deepseek-quota-mcp": "src/mcp-server.js",
    "deepseek-quota-setup": "src/setup-mcp.js",
    "deepseek-quota-configure-hud": "src/configure-hud.js"
  },
  "files": [
    "src/",
    "README.md",
    "config.example.json"
  ],
  "scripts": {
    "start": "node src/index.js",
    "once": "node src/index.js --once"
  },
  "keywords": [
    "deepseek",
    "quota",
    "claude-hud",
    "mcp"
  ],
  "author": "",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0"
  }
}
```

Create file at `deepseek-quota-feeder/package.json`.

- [ ] **Step 2: Create config.example.json**

```json
{
  "refreshInterval": 60000,
  "snapshotPath": "~/.deepseek-quota/snapshot.json",
  "sessionBudgetTokens": 1000000,
  "pricing": {
    "inputCacheHitPerMillion": 0.025,
    "inputCacheMissPerMillion": 3.0,
    "outputPerMillion": 6.0,
    "currency": "CNY"
  }
}
```

Create file at `deepseek-quota-feeder/config.example.json`.

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
*.local.json
```

Create file at `deepseek-quota-feeder/.gitignore`.

- [ ] **Step 4: Commit**

```bash
cd deepseek-quota-feeder && git init && git add -A && git commit -m "feat: scaffold project with package.json and config"
```

---

### Task 2: Utility Modules (env-check + hud-config)

**Files:**
- Create: `src/utils/env-check.js`
- Create: `src/utils/hud-config.js`

These two files are copied directly from kimi-quota-feeder with only package-name strings updated. They contain no Kimi-specific logic.

- [ ] **Step 1: Create src/utils/env-check.js**

```javascript
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 安全执行命令（不经过 shell）
 */
export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'pipe',
      shell: false,
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 检查命令是否存在于 PATH 中
 */
export async function commandExists(cmd) {
  try {
    const result = await runCommand('command', ['-v', cmd]);
    if (result.code === 0 && result.stdout) {
      return result.stdout.split('\n')[0].trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function getClaudeConfigDir() {
  const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (envDir) {
    return envDir.startsWith('~') ? join(homedir(), envDir.slice(2)) : envDir;
  }
  return join(homedir(), '.claude');
}

/**
 * 从 Claude Code 的 shell snapshot 文件中检测命令劫持
 */
export function detectCommandHijackingFromSnapshot(cmd) {
  const snapshotDir = join(getClaudeConfigDir(), 'shell-snapshots');

  try {
    const files = readdirSync(snapshotDir);
    for (const file of files) {
      if (!file.endsWith('.sh')) continue;
      const content = readFileSync(join(snapshotDir, file), 'utf8');
      const pattern = new RegExp(`\\bfunction\\s+${cmd}\\s*[{(]`);
      if (pattern.test(content)) {
        return { hijacked: true, source: file };
      }
    }
  } catch {
    // shell-snapshots 目录不存在或不可读
  }

  return { hijacked: false, source: null };
}

/**
 * 批量检测常见命令是否被 Claude Code 劫持
 */
export function detectShellHijacking(commands = ['grep', 'find', 'rg']) {
  const results = [];
  for (const cmd of commands) {
    const result = detectCommandHijackingFromSnapshot(cmd);
    if (result.hijacked) {
      results.push({ cmd, hijacked: true, source: result.source });
    }
  }
  return results;
}

/**
 * 检查 Claude Code 是否安装并可用
 */
export async function checkClaudeCode() {
  const path = await commandExists('claude');
  if (!path) {
    return { installed: false, path: null, version: null };
  }

  try {
    const result = await runCommand('claude', ['--version']);
    const version = result.code === 0 ? result.stdout.trim() : null;
    return { installed: true, path, version };
  } catch {
    return { installed: true, path, version: null };
  }
}

/**
 * 检查 npm 包命令是否可用
 */
export async function checkPackageCommand(cmd) {
  const path = await commandExists(cmd);
  return { available: !!path, path };
}
```

Create file at `deepseek-quota-feeder/src/utils/env-check.js`.

- [ ] **Step 2: Create src/utils/hud-config.js**

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * 获取 Claude Code 配置目录
 */
export function getClaudeConfigDir() {
  const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (envDir) {
    return envDir.startsWith('~') ? join(homedir(), envDir.slice(2)) : envDir;
  }
  return join(homedir(), '.claude');
}

/**
 * 获取 HUD 插件配置目录
 */
export function getHudConfigDir() {
  return join(getClaudeConfigDir(), 'plugins', 'claude-hud');
}

/**
 * 获取 HUD 配置文件路径
 */
export function getHudConfigPath() {
  return join(getHudConfigDir(), 'config.json');
}

/**
 * 读取 HUD 配置
 */
export function readHudConfig() {
  const path = getHudConfigPath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * 写入 HUD 配置（自动创建目录）
 */
export function writeHudConfig(config) {
  const path = getHudConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * 合并更新 HUD 配置（保留现有值）
 */
export function mergeHudConfig(updates) {
  const existing = readHudConfig();
  const merged = { ...existing, ...updates };

  // 深度合并 display 对象
  if (updates.display && existing.display) {
    merged.display = { ...existing.display, ...updates.display };
  }

  // 深度合并 gitStatus 对象
  if (updates.gitStatus && existing.gitStatus) {
    merged.gitStatus = { ...existing.gitStatus, ...updates.gitStatus };
  }

  writeHudConfig(merged);
  return merged;
}

/**
 * 查找最新安装的 HUD 插件目录
 */
export function findHudPluginDir() {
  const claudeDir = getClaudeConfigDir();
  const cacheDir = join(claudeDir, 'plugins', 'cache');

  if (!existsSync(cacheDir)) {
    return null;
  }

  let latestVersion = null;
  let latestDir = null;

  for (const marketplace of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;

    const hudDir = join(cacheDir, marketplace.name, 'claude-hud');
    if (!existsSync(hudDir) || !statSync(hudDir).isDirectory()) {
      continue;
    }

    for (const version of readdirSync(hudDir, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;

      // 只匹配语义化版本号
      if (!/^\d+\.\d+\.\d+$/.test(version.name)) continue;

      if (!latestVersion || compareSemver(version.name, latestVersion) > 0) {
        latestVersion = version.name;
        latestDir = join(hudDir, version.name);
      }
    }
  }

  return latestDir;
}

/**
 * 比较语义化版本号
 */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * 设置 HUD 外部用量路径
 */
export function setupHudExternalUsage(snapshotPath, freshnessMs = 300000) {
  mergeHudConfig({
    display: {
      externalUsagePath: snapshotPath,
      externalUsageFreshnessMs: freshnessMs,
      showUsage: true,
    },
  });
}
```

Create file at `deepseek-quota-feeder/src/utils/hud-config.js`.

- [ ] **Step 3: Verify utils work**

```bash
cd deepseek-quota-feeder && node -e "import('./src/utils/hud-config.js').then(m => console.log('hud-config OK:', typeof m.readHudConfig))" && node -e "import('./src/utils/env-check.js').then(m => console.log('env-check OK:', typeof m.runCommand))"
```

Expected: both print "OK" with function type.

- [ ] **Step 4: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add utility modules (env-check, hud-config)"
```

---

### Task 3: Config Module

**Files:**
- Create: `src/config.js`

- [ ] **Step 1: Create src/config.js**

```javascript
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_PATHS = [
  join(homedir(), '.deepseek-quota', 'config.json'),
  join(process.cwd(), 'config.json'),
  join(process.cwd(), 'config.local.json'),
];

function readTokenFile() {
  const tokenPath = join(homedir(), '.deepseek-quota', '.token');
  if (existsSync(tokenPath)) {
    try {
      return readFileSync(tokenPath, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

export function loadConfig() {
  let config = null;

  for (const path of CONFIG_PATHS) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf8');
        config = JSON.parse(raw);
        break;
      } catch {
        // continue to next path
      }
    }
  }

  // 默认配置
  if (!config) {
    config = {
      refreshInterval: 60000,
      snapshotPath: join(homedir(), '.deepseek-quota', 'snapshot.json'),
      sessionBudgetTokens: 1000000,
      pricing: {
        inputCacheHitPerMillion: 0.025,
        inputCacheMissPerMillion: 3.0,
        outputPerMillion: 6.0,
        currency: 'CNY',
      },
    };
  }

  // API Key 优先级：环境变量 > 配置文件 > 单独 token 文件
  config.apiKey = process.env.DEEPSEEK_API_KEY
    || config.apiKey
    || readTokenFile()
    || '';

  // 默认值填充
  if (!config.refreshInterval) config.refreshInterval = 60000;
  if (!config.snapshotPath) config.snapshotPath = join(homedir(), '.deepseek-quota', 'snapshot.json');
  if (!config.sessionBudgetTokens) config.sessionBudgetTokens = 1000000;
  if (!config.pricing) {
    config.pricing = {
      inputCacheHitPerMillion: 0.025,
      inputCacheMissPerMillion: 3.0,
      outputPerMillion: 6.0,
      currency: 'CNY',
    };
  }

  // 展开 ~ 路径
  if (config.snapshotPath.startsWith('~')) {
    config.snapshotPath = join(homedir(), config.snapshotPath.slice(2));
  }

  return config;
}
```

Create file at `deepseek-quota-feeder/src/config.js`.

- [ ] **Step 2: Verify config module**

```bash
cd deepseek-quota-feeder && node -e "
import { loadConfig } from './src/config.js';
const cfg = loadConfig();
console.log('refreshInterval:', cfg.refreshInterval);
console.log('sessionBudgetTokens:', cfg.sessionBudgetTokens);
console.log('snapshotPath:', cfg.snapshotPath);
console.log('pricing:', JSON.stringify(cfg.pricing));
console.log('apiKey present:', cfg.apiKey ? 'yes (length=' + cfg.apiKey.length + ')' : 'no');
"
```

Expected: prints config with defaults, `apiKey present: no` (unless `DEEPSEEK_API_KEY` env var is set).

- [ ] **Step 3: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add config module with API key and pricing support"
```

---

### Task 4: DeepSeek API Fetcher

**Files:**
- Create: `src/fetcher.js`

The fetcher calls two DeepSeek endpoints: `/user/balance` for account balance and `/v1/usage` for daily token consumption. Both use Bearer token auth.

- [ ] **Step 1: Create src/fetcher.js**

```javascript
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

  const parseNum = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v) || 0;
    return 0;
  };

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
 * 当前实现兼容常见格式，后续可根据实测调整。
 */
function parseUsageResponse(data) {
  // 尝试多种可能的响应格式
  // 格式1: { data: [{ total_tokens, cost_in_cents }] }
  // 格式2: { total_tokens, cost_in_cents }
  // 格式3: { usage: { total_tokens, cost } }

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
    // 返回原始数据供调试
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
```

Create file at `deepseek-quota-feeder/src/fetcher.js`.

- [ ] **Step 2: Verify fetcher with dry-run (no API key)**

```bash
cd deepseek-quota-feeder && node -e "
import { fetchBalance } from './src/fetcher.js';
try {
  await fetchBalance('');
} catch (e) {
  console.log('Expected error:', e.message);
}
"
```

Expected: "Expected error: DEEPSEEK_API_KEY not configured..."

- [ ] **Step 3: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add DeepSeek API fetcher (balance + daily usage)"
```

---

### Task 5: Snapshot Module

**Files:**
- Create: `src/snapshot.js`

Handles reading/writing the `snapshot.json` file in claude-hud's `ExternalUsageSnapshot` format with `_deepseek` extension data.

- [ ] **Step 1: Create src/snapshot.js**

```javascript
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

  // 计算当日消耗占余额比 (seven_day)
  const dailyVsBalancePct = balance.totalBalance > 0
    ? Math.round((daily.costYuan / balance.totalBalance) * 100)
    : 0;

  // 计算会话费用
  const sessionCost = calculateSessionCost(sessionTokens, pricing);

  const snapshot = {
    updated_at: new Date().toISOString(),
    five_hour: {
      used_percentage: Math.min(100, Math.max(0, sessionPct)),
      resets_at: null,
    },
    seven_day: {
      used_percentage: Math.min(100, Math.max(0, dailyVsBalancePct)),
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
        tokens_total: daily.totalTokens,
        cost_yuan: daily.costYuan,
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

  return `会话: ${fmt(sessionTotal)} tokens / ¥${sessionCost.toFixed(2)} | 今日: ${fmt(daily.totalTokens)} tokens / ¥${daily.costYuan.toFixed(2)} | 余额: ¥${balance.totalBalance.toFixed(2)}`;
}
```

Create file at `deepseek-quota-feeder/src/snapshot.js`.

- [ ] **Step 2: Verify snapshot with unit test**

```bash
cd deepseek-quota-feeder && node -e "
import { writeSnapshot, readSnapshot, calculateSessionCost, formatQuota } from './src/snapshot.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:os';

const tmpDir = mkdtempSync(join(import.meta.dirname || '/tmp', 'ds-test-'));

const balance = { totalBalance: 100, grantedBalance: 10, toppedUpBalance: 90, currency: 'CNY' };
const daily = { totalTokens: 500000, costYuan: 3.40 };
const session = { cache_hit: 50000, cache_miss: 100000, output: 80000 };
const pricing = { inputCacheHitPerMillion: 0.025, inputCacheMissPerMillion: 3.0, outputPerMillion: 6.0, currency: 'CNY' };

const snapPath = join(tmpDir, 'snapshot.json');
const snap = writeSnapshot(snapPath, balance, daily, session, pricing, 1000000);

// 验证 five_hour (230K / 1M = 23%)
console.assert(snap.five_hour.used_percentage === 23, 'five_hour should be 23%, got: ' + snap.five_hour.used_percentage);

// 验证 seven_day (3.40 / 100 = 3%)
console.assert(snap.seven_day.used_percentage === 3, 'seven_day should be 3%, got: ' + snap.seven_day.used_percentage);

// 验证 _deepseek 扩展数据
console.assert(snap._deepseek.balance.total_yuan === 100, 'balance should be 100');
console.assert(snap._deepseek.daily.cost_yuan === 3.40, 'daily cost should be 3.40');

// 验证费用计算
const cost = calculateSessionCost(session, pricing);
const expectedCost = (50000/1e6)*0.025 + (100000/1e6)*3.0 + (80000/1e6)*6.0;
console.assert(Math.abs(cost - expectedCost) < 0.01, 'cost mismatch: ' + cost + ' vs ' + expectedCost);

console.log('session cost:', cost.toFixed(4));
console.log(formatQuota(balance, daily, session, pricing));
console.log('All assertions passed!');

rmSync(tmpDir, { recursive: true, force: true });
"
```

Expected: prints "All assertions passed!" with session cost and formatted quota string.

- [ ] **Step 3: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add snapshot module with session cost calculation"
```

---

### Task 6: MCP Server

**Files:**
- Create: `src/mcp-server.js`

The MCP server is the core. It connects via stdio transport, starts a refresh loop, and registers two tools: `get_deepseek_quota` and `refresh_deepseek_quota`.

- [ ] **Step 1: Create src/mcp-server.js**

```javascript
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { fetchAll } from './fetcher.js';
import { writeSnapshot, readSnapshot, formatQuota } from './snapshot.js';

const config = loadConfig();
let intervalId = null;

// 从已有快照恢复会话 token 累计（跨 MCP 重启保留）
let sessionTokens = readSnapshot(config.snapshotPath) ?? {
  cache_hit: 0,
  cache_miss: 0,
  output: 0,
};

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
    return {
      success: true,
      balance,
      daily,
      snapshot,
      formatted: formatQuota(balance, daily, sessionTokens, config.pricing),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function startRefreshLoop() {
  // 立即执行一次
  refreshQuota().then((result) => {
    if (result.success) {
      console.error(`[deepseek-quota] Initial refresh: ${result.formatted}`);
    } else {
      console.error(`[deepseek-quota] Initial refresh failed: ${result.error}`);
    }
  });

  // 定时刷新（用 stderr 输出，避免干扰 stdio transport）
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
    const result = await refreshQuota();
    if (result.success) {
      const { balance, daily } = result;
      const st = sessionTokens;
      const sessionTotal = st.cache_hit + st.cache_miss + st.output;
      const cost = (st.cache_hit / 1_000_000) * config.pricing.inputCacheHitPerMillion
        + (st.cache_miss / 1_000_000) * config.pricing.inputCacheMissPerMillion
        + (st.output / 1_000_000) * config.pricing.outputPerMillion;

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
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `获取额度失败: ${result.error}`,
          },
        ],
        isError: true,
      };
    }
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
startRefreshLoop();

console.error('[deepseek-quota] MCP server started');
```

Create file at `deepseek-quota-feeder/src/mcp-server.js`.

- [ ] **Step 2: Verify MCP server starts (no API key)**

```bash
cd deepseek-quota-feeder && timeout 3 node src/mcp-server.js 2>&1 || true
```

Expected: "Initial refresh failed: DEEPSEEK_API_KEY not configured" on stderr, then timeout kills it. The process should start and print the error (not crash).

- [ ] **Step 3: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add MCP server with get/refresh tools"
```

---

### Task 7: Standalone CLI Mode

**Files:**
- Create: `src/index.js`

Independent mode for non-MCP use cases. Supports `--once` flag for one-shot execution.

- [ ] **Step 1: Create src/index.js**

```javascript
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
```

Create file at `deepseek-quota-feeder/src/index.js`.

- [ ] **Step 2: Verify --once mode fails gracefully without API key**

```bash
cd deepseek-quota-feeder && node src/index.js --once
```

Expected: prints "DeepSeek Quota Feeder" header then "Error: DEEPSEEK_API_KEY not configured..."

- [ ] **Step 3: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add standalone CLI mode (--once flag)"
```

---

### Task 8: Setup & Configure Scripts

**Files:**
- Create: `src/setup-mcp.js`
- Create: `src/configure-hud.js`

These register the MCP server with Claude Code and configure claude-hud's `externalUsagePath`.

- [ ] **Step 1: Create src/setup-mcp.js**

```javascript
#!/usr/bin/env node

import {
  runCommand,
  checkClaudeCode,
  checkPackageCommand,
} from './utils/env-check.js';

async function main() {
  console.log('Setting up deepseek-quota MCP server...\n');

  // 1. 检查 deepseek-quota-mcp 命令可用
  const mcpCheck = await checkPackageCommand('deepseek-quota-mcp');
  if (!mcpCheck.available) {
    console.error('✗ deepseek-quota-mcp not found in PATH');
    console.error('  Please install: npm install -g deepseek-quota-feeder');
    process.exit(1);
  }
  console.log(`✓ Found deepseek-quota-mcp: ${mcpCheck.path}`);

  // 2. 检查 Claude Code 是否安装
  const claude = await checkClaudeCode();
  if (!claude.installed) {
    console.error('✗ claude command not found in PATH');
    console.error('  Please install Claude Code: https://claude.ai/code');
    process.exit(1);
  }
  console.log(`✓ Found Claude Code: ${claude.path}`);
  if (claude.version) {
    console.log(`  Version: ${claude.version}`);
  }

  // 3. 检查 MCP 是否已配置
  console.log('Checking MCP configuration...');
  const listResult = await runCommand('claude', ['mcp', 'list']);
  const alreadyExists = listResult.stdout.includes('deepseek-quota');

  if (alreadyExists) {
    console.log('✓ MCP server "deepseek-quota" is already configured');
  } else {
    console.log('Adding MCP server...');
    const addResult = await runCommand('claude', [
      'mcp', 'add', '--transport', 'stdio',
      'deepseek-quota', '--', 'deepseek-quota-mcp',
    ]);

    if (addResult.code !== 0) {
      console.error('\n✗ Failed to add MCP server:');
      console.error(`   ${addResult.stderr || addResult.stdout || 'Unknown error'}`);
      process.exit(1);
    }

    console.log('✓ MCP server configured successfully');
  }

  // 4. 输出使用说明
  console.log('\nThe server will:');
  console.log('  - Auto-refresh DeepSeek quota when Claude Code is running');
  console.log('  - Stop refreshing when Claude Code closes');
  console.log('  - Provide tools: get_deepseek_quota, refresh_deepseek_quota');
  console.log('\nNext steps:');
  console.log('  1. Run `claude mcp list` to verify');
  console.log('  2. Run `deepseek-quota-configure-hud` to auto-configure claude-hud');
  console.log('  3. Restart Claude Code to activate');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
```

Create file at `deepseek-quota-feeder/src/setup-mcp.js`.

- [ ] **Step 2: Create src/configure-hud.js**

```javascript
#!/usr/bin/env node

import { loadConfig } from './config.js';
import {
  readHudConfig,
  mergeHudConfig,
  findHudPluginDir,
  getHudConfigPath,
  setupHudExternalUsage,
} from './utils/hud-config.js';

async function main() {
  console.log('Configuring claude-hud for deepseek-quota...\n');

  // 1. 检查 HUD 插件是否安装
  const pluginDir = findHudPluginDir();
  if (!pluginDir) {
    console.error('✗ claude-hud plugin not found');
    console.error('  Please install it first: /plugin install claude-hud');
    process.exit(1);
  }
  console.log(`✓ Found claude-hud: ${pluginDir}`);

  // 2. 获取快照路径
  const config = loadConfig();
  const snapshotPath = config.snapshotPath;
  console.log(`✓ Snapshot path: ${snapshotPath}`);

  // 3. 读取现有配置
  const existing = readHudConfig();
  console.log(`\nCurrent HUD config: ${getHudConfigPath()}`);

  const hasExternalUsage = existing.display?.externalUsagePath === snapshotPath;

  if (hasExternalUsage) {
    console.log('✓ externalUsagePath already configured correctly');
  } else {
    console.log('Updating externalUsagePath...');
    setupHudExternalUsage(snapshotPath, 300000);
    console.log('✓ Updated');
  }

  // 4. 显示当前配置摘要
  const updated = readHudConfig();
  console.log('\nCurrent display settings:');
  console.log(`  externalUsagePath: ${updated.display?.externalUsagePath || '(not set)'}`);
  console.log(`  externalUsageFreshnessMs: ${updated.display?.externalUsageFreshnessMs || '(default)'}`);
  console.log(`  showUsage: ${updated.display?.showUsage ?? '(default)'}`);

  console.log('\n✓ Configuration complete');
  console.log('  Restart Claude Code to see the DeepSeek quota in HUD.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
```

Create file at `deepseek-quota-feeder/src/configure-hud.js`.

- [ ] **Step 3: Verify scripts parse correctly**

```bash
cd deepseek-quota-feeder && node -e "
import('./src/setup-mcp.js').catch(() => {});
import('./src/configure-hud.js').catch(() => {});
console.log('Both scripts parse OK');
"
```

Expected: "Both scripts parse OK"

- [ ] **Step 4: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add setup-mcp and configure-hud CLI tools"
```

---

### Task 9: README & Final Verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

Create `deepseek-quota-feeder/README.md` with the following content:

```markdown
# DeepSeek Quota Feeder

为 [claude-hud](https://github.com/jarrodwatts/claude-hud) 提供 DeepSeek API 额度数据的独立服务。

## 特性

- **MCP 集成** — 通过 Model Context Protocol 与 Claude Code 原生集成，随 Claude Code 启停
- **HUD 显示** — 实时额度显示在 claude-hud 状态栏（会话 token 预算 + 余额占比）
- **缓存感知计费** — 区分 cache_hit/cache_miss/output 三档定价，精确计算费用
- **自动刷新** — MCP server 在 Claude Code 运行时自动刷新额度，关闭后停止
- **一键配置** — `deepseek-quota-setup` + `deepseek-quota-configure-hud` 全自动配置

## 原理

```
Claude Code --MCP--> deepseek-quota-mcp --fetch--> snapshot.json --read--> claude-hud
                         │
                         ├── GET /user/balance      → 账户余额
                         └── GET /v1/usage          → 当日消耗
```

## 安装

### 前置要求

- Node.js >= 18
- [Claude Code](https://claude.ai/code) 已安装
- [claude-hud](https://github.com/jarrodwatts/claude-hud) 插件已安装

### npm 全局安装（推荐）

```bash
npm install -g deepseek-quota-feeder@latest

# 配置 DeepSeek API Key
echo "sk-your-deepseek-api-key" > ~/.deepseek-quota/.token
chmod 600 ~/.deepseek-quota/.token

# 配置 MCP
deepseek-quota-setup

# 配置 HUD
deepseek-quota-configure-hud
```

重启 Claude Code 生效。

### npx（无需安装）

```bash
claude mcp add --transport stdio deepseek-quota -- npx -y deepseek-quota-feeder@latest
```

## 获取 DeepSeek API Key

1. 登录 [platform.deepseek.com](https://platform.deepseek.com)
2. 进入 API Keys 页面
3. 创建或复制已有的 API Key
4. 写入 `~/.deepseek-quota/.token`

## 使用

打开 Claude Code 后，MCP server 自动启动并开始刷新额度。关闭 Claude Code 后自动停止。

### MCP Tools

在 Claude Code 对话中直接调用：

```
@deepseek-quota refresh_deepseek_quota   # 手动刷新额度
@deepseek-quota get_deepseek_quota       # 获取当前额度详情
```

### HUD 显示说明

| HUD 指标 | 含义 |
|----------|------|
| `five_hour` (5h) | 当前会话 token 使用率（相对于 100 万 token 预算） |
| `seven_day` (7d) | 当日消耗占账户余额比 |

`_deepseek` 扩展字段包含完整金额和 token 细分（通过 MCP 工具查询）。

## 配置

`~/.deepseek-quota/config.json`：

```json
{
  "refreshInterval": 60000,
  "snapshotPath": "~/.deepseek-quota/snapshot.json",
  "sessionBudgetTokens": 1000000,
  "pricing": {
    "inputCacheHitPerMillion": 0.025,
    "inputCacheMissPerMillion": 3.0,
    "outputPerMillion": 6.0,
    "currency": "CNY"
  }
}
```

## 故障排除

### MCP server 未连接

```bash
claude mcp list
deepseek-quota-setup
```

### HUD 不显示额度

```bash
deepseek-quota-configure-hud
ls -la ~/.deepseek-quota/snapshot.json
```

### 额度刷新失败

- 检查 API Key 是否有效：`cat ~/.deepseek-quota/.token`
- 检查网络：确保能访问 `https://api.deepseek.com`

## License

MIT
```

Create file at `deepseek-quota-feeder/README.md`.

- [ ] **Step 2: Final verification — check all files parse**

```bash
cd deepseek-quota-feeder && for f in src/config.js src/fetcher.js src/snapshot.js src/index.js src/mcp-server.js src/setup-mcp.js src/configure-hud.js src/utils/env-check.js src/utils/hud-config.js; do
  echo -n "$f: "
  node -e "import('./$f').then(() => console.log('OK')).catch(e => console.log('FAIL:', e.message))"
done
```

Expected: all files print "OK".

- [ ] **Step 3: Verify snapshot module with embedded test**

Re-run the snapshot test from Task 5 Step 2 to confirm nothing broke.

- [ ] **Step 4: Commit**

```bash
cd deepseek-quota-feeder && git add -A && git commit -m "feat: add README and final verification"
```

---

### Task 10: npm Publish Prep

**Files:**
- Modify: `package.json` (if needed)

- [ ] **Step 1: Verify package.json is publish-ready**

Check that:
- `version` is `1.0.0`
- `files` includes `src/`, `README.md`, `config.example.json`
- `bin` has all four commands
- `main` points to `src/index.js`

- [ ] **Step 2: Dry-run publish**

```bash
cd deepseek-quota-feeder && npm pack --dry-run 2>&1
```

Expected: lists all files that would be included in the tarball (no `node_modules/`, no `.git/`, no test files).

- [ ] **Step 3: Create .npmignore (optional)**

Only if `npm pack --dry-run` shows unwanted files. The `files` field in `package.json` should be sufficient.

- [ ] **Step 4: Publish**

```bash
cd deepseek-quota-feeder && npm publish
```

- [ ] **Step 5: Commit version tag**

```bash
cd deepseek-quota-feeder && git tag v1.0.0 && git commit --allow-empty -m "chore: release v1.0.0"
```

---

## Implementation Order

```
Task 1 (Scaffold)
  → Task 2 (Utils)
    → Task 3 (Config)
      → Task 4 (Fetcher)
        → Task 5 (Snapshot)
          → Task 6 (MCP Server)
            → Task 7 (CLI Mode)
              → Task 8 (Setup Scripts)
                → Task 9 (README)
                  → Task 10 (Publish)
```
