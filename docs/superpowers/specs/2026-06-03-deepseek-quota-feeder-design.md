# DeepSeek Quota Feeder — 设计规格

## 概述

为 claude-hud 提供 DeepSeek API 实时用量监控的独立服务。完整复用 [kimi-quota-feeder](https://github.com/LeepeiZ/kimi-quota-feeder) 架构，通过 MCP + Snapshot 桥接机制将 DeepSeek 账户余额、当日消耗、会话 token 统计展示在 claude-hud 状态栏，同时提供 MCP 工具供对话中查询详细信息。

## 架构

```
Claude Code --MCP--> deepseek-quota-mcp --fetch--> snapshot.json --read--> claude-hud
                         │
                         ├── GET /user/balance      → 账户余额
                         └── GET /v1/usage          → 当日消耗
```

### 核心三要素

1. **MCP Server**（stdio transport）— Claude Code 启动时自动拉起，内部定时刷新循环（默认 60s），Claude Code 关闭后进程自动终止
2. **Snapshot 文件** — MCP 定时写入 `~/.deepseek-quota/snapshot.json`，claude-hud 通过 `externalUsagePath` 读取并渲染
3. **一键配置** — `deepseek-quota-setup` 注册 MCP + `deepseek-quota-configure-hud` 配置 HUD

## 数据模型

### 定价（DeepSeek V4-Pro，2026年5月31日起永久生效）

| 计费维度 | 价格（¥/百万 token） |
|---|---|
| 输入（缓存命中） | ¥0.025 |
| 输入（缓存未命中，含 cache_creation） | ¥3.0 |
| 输出 | ¥6.0 |

### Snapshot 格式

claude-hud 的 `ExternalUsageSnapshot` 类型定义：

```typescript
interface ExternalUsageSnapshot {
  updated_at: string;                          // ISO 8601
  five_hour: {
    used_percentage: number | null;            // 0-100
    resets_at: string | null;                  // ISO 8601
  };
  seven_day: {
    used_percentage: number | null;            // 0-100
    resets_at: string | null;
  };
}
```

### HUD 指标语义重映射

| HUD 字段 | DeepSeek 语义 | 计算方式 |
|---|---|---|
| `five_hour.used_percentage` | 当前会话 token 预算使用率 | session_total_tokens / sessionBudgetTokens × 100 |
| `seven_day.used_percentage` | 当日消耗占余额比 | daily_cost / balance_total × 100 |

### Snapshot 扩展字段

标准字段之上追加 `_deepseek` 命名空间存储详细数据，供 MCP 工具查询：

```json
{
  "updated_at": "2026-06-03T11:00:00Z",
  "five_hour": { "used_percentage": 23, "resets_at": null },
  "seven_day": { "used_percentage": 8, "resets_at": null },
  "_deepseek": {
    "session": {
      "tokens": {
        "cache_hit": 50000,
        "cache_miss": 100000,
        "output": 80000
      },
      "cost_yuan": 1.86
    },
    "daily": {
      "tokens_total": 500000,
      "cost_yuan": 3.40
    },
    "balance": {
      "total_yuan": 47.66,
      "granted_yuan": 10.00,
      "topped_up_yuan": 37.66
    },
    "pricing": {
      "input_cache_hit_per_million": 0.025,
      "input_cache_miss_per_million": 3.0,
      "output_per_million": 6.0
    }
  }
}
```

## DeepSeek API

### GET /user/balance

查询账户余额。

```bash
curl -L -X GET 'https://api.deepseek.com/user/balance' \
  -H 'Accept: application/json' \
  -H 'Authorization: Bearer <API_KEY>'
```

响应：

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

### GET /v1/usage

查询历史用量（按时间范围）。

```bash
curl -X GET "https://api.deepseek.com/v1/usage?start_time=2026-06-03T00:00:00Z&end_time=2026-06-03T23:59:59Z" \
  -H "Authorization: Bearer <API_KEY>"
```

返回当日累计 token 消耗和费用。

## MCP 工具

| 工具名 | 描述 |
|---|---|
| `get_deepseek_quota` | 获取完整用量详情：会话 token+费用（按缓存命中/未命中分拆）、当日消耗、账户余额 |
| `refresh_deepseek_quota` | 手动立即刷新所有数据并写入 snapshot |

### get_deepseek_quota 返回格式

```
DeepSeek 用量详情:

会话统计:
  - Token: 230,000 (缓存命中 50K | 缓存未命中 100K | 输出 80K)
  - 费用: ¥1.86

当日消耗:
  - Token: 500,000
  - 费用: ¥3.40

账户余额:
  - 总余额: ¥47.66
  - 充值余额: ¥37.66
  - 赠送余额: ¥10.00
```

## 会话级 Token 追踪

### 数据来源

会话级 token 从 Claude Code stdin 的 `context_window.current_usage` 获取，已包含 cache_read/cache_creation 细分。MCP 通过读取 HUD 写入的 session token 文件进行累加。

### 费用计算

```
cost = cache_hit_tokens / 1_000_000 × 0.025
     + cache_miss_tokens / 1_000_000 × 3.0
     + output_tokens / 1_000_000 × 6.0
```

### 预算上限

会话 token 预算上限可配置（`sessionBudgetTokens`，默认 1,000,000），`five_hour.used_percentage` 按此预算计算。

### 局限

- 会话 token 拆分（cache_hit/cache_miss/output）依赖 Claude Code stdin 数据粒度。若模型返回的 usage 不含缓存细分，则按总 input token 以 cache_miss 单价计（保守估算）
- `/v1/usage` 的返回值结构需实测确认，可能不区分 input/output；若不区分则按总 token × 混合单价估算

## 配置

### ~/.deepseek-quota/config.json

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

### Token 存储

DeepSeek API Key 存储在 `~/.deepseek-quota/.token`（权限 600），优先级：环境变量 `DEEPSEEK_API_KEY` > 配置文件 > token 文件。

## 项目结构

```
deepseek-quota-feeder/
├── src/
│   ├── index.js              # 独立模式入口（向后兼容）
│   ├── mcp-server.js         # MCP server 入口（stdio transport）
│   ├── setup-mcp.js          # MCP 注册工具
│   ├── configure-hud.js      # HUD 配置工具
│   ├── fetcher.js            # DeepSeek API 抓取（balance + usage）
│   ├── snapshot.js           # 快照文件读写
│   ├── config.js             # 配置加载
│   └── utils/
│       ├── env-check.js      # 环境检测
│       └── hud-config.js     # HUD 配置操作（纯 Node.js fs API）
├── config.example.json
├── package.json
└── README.md
```

## npm 发布

- 包名：`deepseek-quota-feeder`
- 四个 bin 命令：`deepseek-quota-feeder`、`deepseek-quota-mcp`、`deepseek-quota-setup`、`deepseek-quota-configure-hud`
- 依赖：`@modelcontextprotocol/sdk` >= 1.29.0
- engines: node >= 18

## 安装流程

```bash
npm install -g deepseek-quota-feeder

# 配置 API Key
echo "sk-xxx" > ~/.deepseek-quota/.token
chmod 600 ~/.deepseek-quota/.token

# 注册 MCP + 配置 HUD
deepseek-quota-setup
deepseek-quota-configure-hud
```

重启 Claude Code 生效。

## 与 kimi-quota-feeder 的差异

| 维度 | kimi-quota-feeder | deepseek-quota-feeder |
|------|------|------|
| API 认证 | Cookie JWT (kimi-auth) | Bearer API Key |
| 数据源 | Kimi Dashboard 内部 API | DeepSeek `/user/balance` + `/v1/usage` |
| 计费模式 | 配额制（5h + 周限额） | 充值扣费制（按 token 计费） |
| 缓存定价 | 无区分 | cache_hit/cache_miss/output 三档 |
| HUD 展示 | 5h 窗口% + 周额度% | 会话预算% + 当日消耗/余额% |
| 扩展数据 | 无 | `_deepseek` 命名空间存储金额和 token 细分 |
