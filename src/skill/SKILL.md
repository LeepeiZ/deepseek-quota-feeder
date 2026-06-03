---
name: deepseek-quota
description: Use when the user asks to check DeepSeek account balance, quota, usage, or cost — anything about DeepSeek API consumption. Also use when user types "quota", "余额", "用量", "@ds quota", or "deepseek quota".
---

# DeepSeek Quota

Call `mcp__ds__quota` once, then output the result as a plain text code block.

## Instructions

1. Call `mcp__ds__quota` (no arguments) — **only once** per invocation.
2. After the tool returns, write your reply containing ONLY the tool's text output, wrapped in triple backticks.
3. Do NOT call the tool again. Do NOT summarize, paraphrase, or add any commentary.
