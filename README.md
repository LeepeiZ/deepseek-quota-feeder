# DeepSeek Quota Feeder

DeepSeek API 用量监控，一条命令完成 MCP + Skill 配置，零 token 消耗查询实时余额和消费统计。

## 快速开始

```bash
npm install -g deepseek-quota-feeder
echo "sk-your-key" > ~/.deepseek-quota/.token
deepseek-quota-setup
```

重启 Claude Code 即可使用。

## 使用方式

| 命令 | 类型 | 说明 |
|------|------|------|
| `/deepseek-quota` | Slash command | 查询余额、消耗、上次会话统计 |
| `@ds quota` | MCP | 同上，通过 MCP 协议查询 |
| `@ds quota_refresh` | MCP | 强制刷新数据 |
| `deepseek-quota-feeder` | CLI | 独立运行，后台定时刷新 |
| `deepseek-quota-feeder --once` | CLI | 单次查询 |

## 输出示例

```
  ╭──────────────────────────────────────────────╮
  │            🔬  DeepSeek 用量监控             │
  ╰──────────────────────────────────────────────╯

  💰  账户余额
  ┌──────────────────────────────────────────────┐
  │                   ¥ 144.88                   │
  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  │
  │                   剩余 72%                   │
  ├──────────────────────────────────────────────┤
  │  充值 ¥ 144.88    赠送 ¥ 0.00                │
  └──────────────────────────────────────────────┘

  🔥  本次会话消耗
  ┌──────────────────────────────────────────────┐
  │               ¥ 0.0600  (0.0%)               │
  │            ¥ 144.94  →  ¥ 144.88             │
  └──────────────────────────────────────────────┘

  📊  上次会话
  ┌──────────────────────────────────────────────┐
  │ ~/Documents/workspace/anything               │
  ├──────────────────────────────────────────────┤
  │  Token 总计           301,709                │
  │  输入       28.5K    输出        1.3K         │
  │  缓存命中      271.9K                         │
  │  费用  $            0.3113                   │
  └──────────────────────────────────────────────┘

  💡  V4-Pro 定价
  ──────────────────────────────────────────────
  缓存命中  ¥0.025/M    未命中  ¥3.0/M    输出  ¥6.0/M
```

## 获取 DeepSeek API Key

登录 [platform.deepseek.com](https://platform.deepseek.com) → API Keys → 创建 Key。

## 配置

### API Key

三种方式，优先级从高到低：

```bash
# 1. 环境变量
export DEEPSEEK_API_KEY="sk-xxx"

# 2. 配置文件 (~/.deepseek-quota/config.json)
{ "apiKey": "sk-xxx" }

# 3. Token 文件
echo "sk-xxx" > ~/.deepseek-quota/.token
```

`deepseek-quota-setup` 会自动检测 Key 是否已配置并给出提示。

### 可选配置

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

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `refreshInterval` | `60000` | 后台刷新间隔 (ms)，最小 5000 |
| `snapshotPath` | `~/.deepseek-quota/snapshot.json` | 快照文件路径 |
| `sessionBudgetTokens` | `1000000` | 会话 token 预算上限 |
| `pricing` | V4-Pro 定价 | 自定义定价模型 |

## 手动配置 MCP

如果不使用 `deepseek-quota-setup`：

```bash
claude mcp add --transport stdio ds -e DEEPSEEK_API_KEY -- deepseek-quota-mcp
```

## 定价参考

DeepSeek V4-Pro（2026年5月31日起永久生效）：

| 维度 | 价格 (¥/百万 token) |
|------|------|
| 输入（缓存命中） | ¥0.025 |
| 输入（缓存未命中） | ¥3.0 |
| 输出 | ¥6.0 |

## License

MIT
