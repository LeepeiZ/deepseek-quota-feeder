#!/usr/bin/env node

import { loadConfig } from './config.js';
import {
  readHudConfig,
  mergeHudConfig,
  findHudPluginDir,
  getHudConfigPath,
  setupHudExternalUsage,
} from './utils/hud-config.js';

async function main() {
  console.log('Configuring claude-hud for deepseek-quota...\n');

  // 1. Check if HUD plugin is installed
  const pluginDir = findHudPluginDir();
  if (!pluginDir) {
    console.error('✗ claude-hud plugin not found');
    console.error('  Please install it first: /plugin install claude-hud');
    process.exit(1);
  }
  console.log(`✓ Found claude-hud: ${pluginDir}`);

  // 2. Get snapshot path
  const config = loadConfig();
  const snapshotPath = config.snapshotPath;
  console.log(`✓ Snapshot path: ${snapshotPath}`);

  // 3. Read existing configuration
  const existing = readHudConfig();
  console.log(`\nCurrent HUD config: ${getHudConfigPath()}`);

  const hasExternalUsage = existing.display?.externalUsagePath === snapshotPath;

  if (hasExternalUsage) {
    console.log('✓ externalUsagePath already configured correctly');
  } else {
    console.log('Updating externalUsagePath...');
    setupHudExternalUsage(snapshotPath, 300000);
    console.log('✓ Updated');
  }

  // 4. Show current config summary
  const updated = readHudConfig();
  console.log('\nCurrent display settings:');
  console.log(`  externalUsagePath: ${updated.display?.externalUsagePath || '(not set)'}`);
  console.log(`  externalUsageFreshnessMs: ${updated.display?.externalUsageFreshnessMs || '(default)'}`);
  console.log(`  showUsage: ${updated.display?.showUsage ?? '(default)'}`);

  console.log('\n✓ Configuration complete');
  console.log('  Restart Claude Code to see the DeepSeek quota in HUD.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
