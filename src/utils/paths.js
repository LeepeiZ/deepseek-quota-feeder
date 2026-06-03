import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 获取 Claude Code 配置目录
 * 支持 CLAUDE_CONFIG_DIR 环境变量覆盖，默认 ~/.claude
 * @returns {string} 配置目录绝对路径
 */
export function getClaudeConfigDir() {
  const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (envDir) {
    return envDir.startsWith('~') ? join(homedir(), envDir.slice(2)) : envDir;
  }
  return join(homedir(), '.claude');
}
