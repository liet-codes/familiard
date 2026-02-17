#!/usr/bin/env node

/**
 * familiard CLI
 *
 * Usage:
 *   familiard start     — start the daemon (foreground)
 *   familiard status    — show daemon status
 *   familiard journal   — show recent journal entries
 *   familiard init      — interactive setup wizard
 */

import { loadConfig } from './config.js';
import { runDaemon } from './daemon.js';
import { recentEntries, formatJournal } from './journal/index.js';
import { createFilesystemWatcher } from './watchers/filesystem.js';
import { createGitWatcher } from './watchers/git.js';
import type { Watcher, WatcherConfig } from './types.js';

const command = process.argv[2] ?? 'help';

function createWatcher(wc: WatcherConfig): Watcher | null {
  switch (wc.type) {
    case 'filesystem':
      return createFilesystemWatcher({
        paths: wc.paths as string[],
        debounceMs: wc.debounceMs as number | undefined,
      });
    case 'git':
      return createGitWatcher({
        repos: wc.repos as string[],
        events: wc.events as Array<'push' | 'pr' | 'issue'> | undefined,
        pollMs: wc.pollMs as number | undefined,
      });
    default:
      console.warn(`[familiard] unknown watcher type: ${wc.type}`);
      return null;
  }
}

async function start() {
  const config = loadConfig();

  if (config.watchers.length === 0) {
    console.error('No watchers configured. Run `familiard init` first.');
    process.exit(1);
  }

  const watchers: Watcher[] = [];
  for (const wc of config.watchers) {
    const w = createWatcher(wc);
    if (w) watchers.push(w);
  }

  if (watchers.length === 0) {
    console.error('No valid watchers. Check your config.');
    process.exit(1);
  }

  const cleanup = await runDaemon(watchers, config);

  // Graceful shutdown
  const shutdown = () => {
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[familiard] daemon running. Ctrl+C to stop.');
}

function journal() {
  const config = loadConfig();
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const limit = 50;

  const entries = recentEntries(config, limit);
  if (entries.length === 0) {
    console.log('No journal entries yet.');
    return;
  }
  console.log(formatJournal(entries));
}

function help() {
  console.log(`
familiard — the local inference daemon

Commands:
  start      Start the daemon (foreground)
  journal    Show recent journal entries
  init       Interactive setup wizard
  help       Show this help

Options:
  --since=YYYY-MM-DD   Filter journal entries (with 'journal' command)
`);
}

switch (command) {
  case 'start':
    start();
    break;
  case 'journal':
    journal();
    break;
  case 'init':
    console.log('TODO: interactive init wizard');
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
