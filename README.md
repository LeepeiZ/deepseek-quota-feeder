# DeepSeek Quota Feeder

DeepSeek API 用量监控工具，通过 MCP 集成到 Claude Code，零 token 消耗查询实时余额和消费统计。

## 特性

- **MCP 原生集成** — `@ds quota` 直接查询，不消耗对话 token
- **实时余额** — 调用 DeepSeek `/user/balance` API 获取最新余额
- **消耗追踪** — 自动记录初始余额，追踪本次会话累计消耗
- **上次会话统计** — 读取 `.claude.json` 获取上次会话的 Token 明细和费用
- **自动刷新** — 后台每 60s 自动更新数据

## 安装

```bash
npm install -g deepseek-quota-feeder
deepseek-quota-setup
```

配置 API Key：

```bash
echo "sk-your-key" > ~/.deepseek-quota/.token
chmod 600 ~/.deepseek-quota/.token
```

重启 Claude Code，然后 `@ds quota` 即可。

## 获取 DeepSeek API Key

登录 [platform.deepseek.com](https://platform.deepseek.com) → API Keys → 创建 Key。

## 使用

| 命令 | 说明 |
|------|------|
| `@ds quota` | 查询余额、消耗、上次会话统计 |
| `@ds quota_refresh` | 强制刷新数据 |

输出示例：

```
  ╭──────────────────────────────────────────────╮
  │              🔬  DeepSeek 用量监控               │
  ╰──────────────────────────────────────────────╯

  💰  账户余额
  ┌──────────────────────────────────────────────┐
  │                   ¥ 144.88                   │
  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  │
  │                  剩余 72%                     │
  ├──────────────────────────────────────────────┤
  │  充值 ¥ 144.88    赠送 ¥ 0.00                  │
  └──────────────────────────────────────────────┘

  🔥  本次会话消耗
  ┌──────────────────────────────────────────────┐
  │               ¥ 0.0600  (0.0%)               │
  │         ¥ 144.94  →  ¥ 144.88               │
  └──────────────────────────────────────────────┘

  📊  上次会话 (~/Documents/workspace/anything)
  ┌──────────────────────────────────────────────┐
  ├──────────────────────────────────────────────┤
  │  Token 总计           301,709                │
  │  输入       28.5K    输出        1.3K          │
  │  缓存命中      271.9K                          │
  │  费用  $            0.3113                   │
  └──────────────────────────────────────────────┘
```

## 手动配置

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
