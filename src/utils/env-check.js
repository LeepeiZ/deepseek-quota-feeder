import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 安全执行命令（不经过 shell）
 * @param {string} command - 命令名
 * @param {string[]} args - 参数数组
 * @param {object} options - 额外选项
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
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
 * 使用 command -v 绕过 shell 函数/别名
 * @param {string} cmd
 * @returns {Promise<string|null>} 真实路径或 null
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
 * Claude Code 会在 shell 中注入 grep/find 等函数，这些不在 .zshrc/.bashrc 中
 * 而是通过 ~/.claude/shell-snapshots/ 下的临时文件 source 进去的
 * @param {string} cmd
 * @returns {{hijacked: boolean, source: string|null}}
 */
export function detectCommandHijackingFromSnapshot(cmd) {
  const snapshotDir = join(getClaudeConfigDir(), 'shell-snapshots');

  try {
    const files = readdirSync(snapshotDir);
    for (const file of files) {
      if (!file.endsWith('.sh')) continue;
      const content = readFileSync(join(snapshotDir, file), 'utf8');
      // 查找 "function cmd {" 或 "function cmd("
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
 * @param {string[]} commands
 * @returns {Array<{cmd: string, hijacked: boolean, source: string|null}>}
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
 * @returns {Promise<{installed: boolean, path: string|null, version: string|null}>}
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
 * @param {string} cmd - 如 'deepseek-quota-mcp'
 * @returns {Promise<{available: boolean, path: string|null}>}
 */
export async function checkPackageCommand(cmd) {
  const path = await commandExists(cmd);
  return { available: !!path, path };
}
