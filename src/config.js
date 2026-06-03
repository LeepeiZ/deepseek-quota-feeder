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
      } catch (err) {
        console.error(`[deepseek-quota] 配置文件解析失败: ${path} — ${err.message}`);
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

  // 参数校验
  if (typeof config.refreshInterval !== 'number' || config.refreshInterval < 5000) {
    console.warn(`[deepseek-quota] refreshInterval 无效 (${config.refreshInterval})，已设置为 60000ms`);
    config.refreshInterval = 60000;
  }
  if (typeof config.sessionBudgetTokens !== 'number' || config.sessionBudgetTokens <= 0) {
    console.warn(`[deepseek-quota] sessionBudgetTokens 无效 (${config.sessionBudgetTokens})，已设置为 1000000`);
    config.sessionBudgetTokens = 1000000;
  }

  // 展开 ~ 路径
  if (config.snapshotPath.startsWith('~')) {
    config.snapshotPath = join(homedir(), config.snapshotPath.slice(2));
  }

  return config;
}
