/**
 * familiard init — interactive setup wizard.
 *
 * Detects environment, asks what to watch, writes config.
 * Philosophy: zero-config for the default case, 60 seconds to running.
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, CONFIG_PATH, writeConfig, configExists } from './config.js';
import type { FamiliardConfig, WatcherConfig } from './types.js';

function check(label: string, fn: () => boolean): boolean {
  try {
    const ok = fn();
    console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}`);
    return ok;
  } catch {
    console.log(`  ✗ ${label}`);
    return false;
  }
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ollamaModels(): string[] {
  try {
    const out = execSync('ollama list', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out
      .split('\n')
      .slice(1) // skip header
      .map((line) => line.split(/\s+/)[0]!)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` [${defaultVal}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function confirm(rl: ReturnType<typeof createInterface>, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, `${question} ${hint}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

export async function runInit(): Promise<void> {
  console.log('\n🐛 familiard init\n');

  if (configExists()) {
    console.log(`  ⚠ Config already exists at ${CONFIG_PATH}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const overwrite = await confirm(rl, '  Overwrite?', false);
    if (!overwrite) {
      rl.close();
      console.log('  Aborted.');
      return;
    }
    rl.close();
  }

  // Detect environment
  console.log('Checking environment...\n');

  const hasOllama = check('ollama installed', () => commandExists('ollama'));
  const hasGh = check('gh CLI installed', () => commandExists('gh'));

  let model = DEFAULT_CONFIG.model;
  if (hasOllama) {
    const models = ollamaModels();
    if (models.length > 0) {
      check(`models available: ${models.join(', ')}`, () => true);
      // Prefer the default if available, otherwise use first model
      if (models.some((m) => m.startsWith('llama3.1:8b'))) {
        model = 'llama3.1:8b-instruct';
      } else {
        model = models[0]!;
      }
    } else {
      console.log('  ⚠ No models pulled. Run: ollama pull llama3.1:8b-instruct');
    }
  } else {
    console.log('\n  ⚠ ollama not found. Install from https://ollama.ai');
    console.log('  familiard requires ollama for local inference.');
    console.log('  Continuing with config — you can install ollama later.\n');
  }

  // Detect cloud agents
  const hasOpenClaw = check('OpenClaw detected', () =>
    existsSync(join(homedir(), '.openclaw', 'openclaw.json'))
  );

  console.log('');

  // Interactive config
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const config: FamiliardConfig = { ...DEFAULT_CONFIG, model, watchers: [] };

  // Filesystem watching
  const watchHome = await confirm(rl, 'Watch ~/Documents for file changes?');
  if (watchHome) {
    config.watchers.push({
      type: 'filesystem',
      paths: [join(homedir(), 'Documents')],
      debounceMs: 2000,
    });
  }

  const customPath = await ask(rl, 'Watch another directory? (path or empty to skip)');
  if (customPath) {
    // Expand ~ to home directory
    const expanded = customPath.replace(/^~/, homedir());
    if (existsSync(expanded)) {
      config.watchers.push({
        type: 'filesystem',
        paths: [expanded],
        debounceMs: 2000,
      });
    } else {
      console.log(`  ⚠ Directory not found: ${expanded} — skipping`);
    }
  }

  // Git watching
  if (hasGh) {
    const gitRepo = await ask(rl, 'Watch a GitHub repo? (owner/name or empty to skip)');
    if (gitRepo) {
      config.watchers.push({
        type: 'git',
        repos: [gitRepo],
        events: ['pr', 'issue'],
        pollMs: 60_000,
      });
    }
  }

  // Escalation
  const useOpenClaw = await confirm(rl, 'Escalate to an OpenClaw agent when events need attention?');
  if (useOpenClaw) {
    const gatewayUrl = await ask(rl, 'OpenClaw gateway URL', 'http://localhost:18789');
    const token = await ask(rl, 'Gateway auth token');
    const agentId = await ask(rl, 'Agent ID', 'main');

    config.escalation = {
      method: 'openclaw',
      url: gatewayUrl,
      token: token || undefined,
      agentId,
      contextWindow: 10,
    };

    if (!token) {
      console.log('  ⚠ No token provided — set escalation.token in config later');
    }
  }

  // User context
  const context = await ask(rl, 'Describe yourself in one line (helps the classifier)', undefined);
  if (context) {
    config.userContext = context;
  }

  rl.close();

  // Write config
  writeConfig(config);

  console.log(`\n  ✓ Config written to ${CONFIG_PATH}`);
  console.log(`  ✓ ${config.watchers.length} watcher(s) configured`);
  console.log(`  ✓ Model: ${config.model}`);
  console.log(`  ✓ Escalation: ${config.escalation.method}`);
  console.log(`\n  Run: familiard start\n`);
}
