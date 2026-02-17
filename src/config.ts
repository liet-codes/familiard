/**
 * Configuration loading and defaults.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FamiliardConfig } from './types.js';

export const CONFIG_DIR = join(homedir(), '.familiard');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml');
export const JOURNAL_DIR = join(CONFIG_DIR, 'journal');
export const PID_PATH = join(CONFIG_DIR, 'familiard.pid');

export const DEFAULT_CONFIG: FamiliardConfig = {
  model: 'llama3.1:8b-instruct',
  intervalMs: 60_000,
  confidenceThreshold: 0.7,
  watchers: [],
  escalation: {
    method: 'shell',
    command: 'echo "familiard escalation: {{summary}}"',
    contextWindow: 10,
  },
  journal: {
    path: JOURNAL_DIR,
  },
};

export function loadConfig(): FamiliardConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  // TODO: parse YAML config and merge with defaults
  // For now, return defaults
  return { ...DEFAULT_CONFIG };
}
