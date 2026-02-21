/**
 * Configuration loading, defaults, and example generation.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
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
    command: 'echo',
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

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = yaml.load(raw) as Partial<FamiliardConfig> | null;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_CONFIG };
    }

    // Validate numerics
    const intervalMs = typeof parsed.intervalMs === 'number' && parsed.intervalMs > 0
      ? parsed.intervalMs : DEFAULT_CONFIG.intervalMs;
    const confidenceThreshold = typeof parsed.confidenceThreshold === 'number'
      && parsed.confidenceThreshold >= 0 && parsed.confidenceThreshold <= 1
      ? parsed.confidenceThreshold : DEFAULT_CONFIG.confidenceThreshold;

    return {
      model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_CONFIG.model,
      intervalMs,
      confidenceThreshold,
      watchers: Array.isArray(parsed.watchers) ? parsed.watchers : [],
      escalation: {
        method: parsed.escalation?.method ?? DEFAULT_CONFIG.escalation.method,
        command: parsed.escalation?.command ?? DEFAULT_CONFIG.escalation.command,
        url: parsed.escalation?.url,
        token: parsed.escalation?.token,
        headers: parsed.escalation?.headers,
        agentId: parsed.escalation?.agentId,
        contextWindow: parsed.escalation?.contextWindow ?? DEFAULT_CONFIG.escalation.contextWindow,
      },
      journal: {
        path: parsed.journal?.path ?? DEFAULT_CONFIG.journal.path,
      },
      userContext: parsed.userContext,
    };
  } catch (err) {
    console.error(`[config] failed to parse ${CONFIG_PATH}:`, err);
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: FamiliardConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const content = yaml.dump(config, { lineWidth: 100, noRefs: true });
  writeFileSync(CONFIG_PATH, content, 'utf-8');
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}
