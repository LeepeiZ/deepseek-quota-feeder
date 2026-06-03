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
