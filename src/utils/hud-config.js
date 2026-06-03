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
 * @returns {object} 配置对象（不存在返回空对象）
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
 * @param {object} config
 */
export function writeHudConfig(config) {
  const path = getHudConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * 合并更新 HUD 配置（保留现有值）
 * @param {object} updates - 要更新的键值
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
 * 用 Node.js API 替代 ls | awk | grep | sort | cut 管道
 * @returns {string|null}
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
 * @param {string} a - 如 "1.2.3"
 * @param {string} b - 如 "1.2.4"
 * @returns {number} >0 if a>b, <0 if a<b, 0 if equal
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
 * @param {string} snapshotPath - 快照文件绝对路径
 * @param {number} freshnessMs - 新鲜度阈值（毫秒）
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
