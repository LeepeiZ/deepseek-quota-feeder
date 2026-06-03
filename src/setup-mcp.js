#!/usr/bin/env node

import {
  runCommand,
  checkClaudeCode,
  checkPackageCommand,
} from './utils/env-check.js';

const MCP_NAME = 'ds';
const MCP_CMD = 'deepseek-quota-mcp';

async function main() {
  console.log('Setting up DeepSeek quota MCP server...\n');

  // 1. Check deepseek-quota-mcp command availability
  const mcpCheck = await checkPackageCommand(MCP_CMD);
  if (!mcpCheck.available) {
    console.error(`✗ ${MCP_CMD} not found in PATH`);
    console.error('  Please install: npm install -g deepseek-quota-feeder');
    process.exit(1);
  }
  console.log(`✓ Found ${MCP_CMD}: ${mcpCheck.path}`);

  // 2. Check Claude Code installation
  const claude = await checkClaudeCode();
  if (!claude.installed) {
    console.error('✗ claude command not found in PATH');
    console.error('  Please install Claude Code: https://claude.ai/code');
    process.exit(1);
  }
  console.log(`✓ Found Claude Code: ${claude.path}`);
  if (claude.version) console.log(`  Version: ${claude.version}`);

  // 3. Register MCP server
  console.log('Registering MCP server...');
  const addResult = await runCommand('claude', [
    'mcp', 'add', '--transport', 'stdio',
    MCP_NAME, '-e', 'DEEPSEEK_API_KEY',
    '--', MCP_CMD,
  ]);

  if (addResult.code !== 0) {
    // Maybe already exists, try with force or check
    const listResult = await runCommand('claude', ['mcp', 'list']);
    if (listResult.stdout.includes(MCP_NAME)) {
      console.log(`✓ MCP server "${MCP_NAME}" already configured`);
    } else {
      console.error('\n✗ Failed to register MCP server:');
      console.error(`   ${addResult.stderr || addResult.stdout || 'Unknown error'}`);
      process.exit(1);
    }
  } else {
    console.log(`✓ MCP server "${MCP_NAME}" registered`);
  }

  // 4. Usage
  console.log('\n✨ Setup complete!\n');
  console.log('  Usage:  @ds quota         — query balance + consumption');
  console.log('          @ds quota_refresh  — force refresh');
  console.log('');
  console.log('  API key: echo "sk-xxx" > ~/.deepseek-quota/.token');
  console.log('');
  console.log('  Restart Claude Code to activate.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
