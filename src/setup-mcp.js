#!/usr/bin/env node

import {
  runCommand,
  checkClaudeCode,
  checkPackageCommand,
} from './utils/env-check.js';

async function main() {
  console.log('Setting up deepseek-quota MCP server...\n');

  // 1. Check deepseek-quota-mcp command availability
  const mcpCheck = await checkPackageCommand('deepseek-quota-mcp');
  if (!mcpCheck.available) {
    console.error('✗ deepseek-quota-mcp not found in PATH');
    console.error('  Please install: npm install -g deepseek-quota-feeder');
    process.exit(1);
  }
  console.log(`✓ Found deepseek-quota-mcp: ${mcpCheck.path}`);

  // 2. Check Claude Code installation
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

  // 3. Check if MCP is already configured
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

  // 4. Output usage instructions
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
