#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const currentVersion = pkg.version;

const platform = process.argv[2];
const BUILD_COMMANDS = {
  mac: 'electron-builder --mac',
  win: 'electron-builder --win',
  linux: 'electron-builder --linux',
};

if (!BUILD_COMMANDS[platform]) {
  console.error(`Usage: node scripts/release.js <mac|win|linux>`);
  process.exit(1);
}

// Get commits since last version tag (or all commits if no tag exists)
function getGitLog() {
  try {
    const lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { cwd: ROOT }).toString().trim();
    return execSync(`git log ${lastTag}..HEAD --pretty=format:"- %s" --no-merges`, { cwd: ROOT }).toString().trim();
  } catch {
    try {
      return execSync('git log --pretty=format:"- %s" --no-merges', { cwd: ROOT }).toString().trim();
    } catch {
      return '';
    }
  }
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\nCurrent version: ${currentVersion}`);
  const input = (await prompt(rl, 'Next version (press Enter to keep current): ')).trim();
  const nextVersion = input || currentVersion;
  const bumpingVersion = nextVersion !== currentVersion;

  if (bumpingVersion) {
    const today = new Date().toISOString().split('T')[0];
    const gitLog = getGitLog();

    console.log('\n--- Commits since last release ---');
    console.log(gitLog || '(none found)');
    console.log('----------------------------------');
    console.log('\nPaste additional changelog notes below.');
    console.log('Each line becomes a bullet. Enter a blank line to finish.\n');

    const extraLines = [];
    while (true) {
      const line = (await prompt(rl, '> ')).trim();
      if (!line) break;
      extraLines.push(`- ${line}`);
    }

    rl.close();

    const allEntries = [gitLog, extraLines.join('\n')].filter(Boolean).join('\n');
    const newEntry = `## [${nextVersion}] - ${today}\n\n### Changed\n${allEntries || '- (no entries)'}`;

    const existing = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const header = existing.startsWith('# Changelog') ? existing.replace('# Changelog\n', '') : `\n${existing}`;
    fs.writeFileSync(CHANGELOG_PATH, `# Changelog\n\n${newEntry}\n${header}`);
    console.log(`\nCHANGELOG.md updated.`);

    pkg.version = nextVersion;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`package.json version → ${nextVersion}`);
  } else {
    rl.close();
    console.log(`Keeping version ${currentVersion} — skipping changelog and version bump.`);
  }

  // Run the build
  console.log(`\nRunning build for ${platform}...\n`);
  const child = spawn('npx', BUILD_COMMANDS[platform].split(' '), {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', code => process.exit(code));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
