import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walAppend, walRemove, walRecover } from './wal.js';
import type { FamiliardConfig, FamiliarEvent } from './types.js';

let tempDir: string;

function makeConfig(): FamiliardConfig {
  return {
    model: 'test',
    intervalMs: 5000,
    confidenceThreshold: 0.6,
    watchers: [],
    escalation: { method: 'shell', contextWindow: 5 },
    journal: { path: join(tempDir, 'journal') },
  };
}

function makeEvent(id: string, summary = 'test'): FamiliarEvent {
  return {
    id,
    source: 'test',
    type: 'test',
    timestamp: new Date('2026-02-17T04:00:00Z'),
    summary,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'familiard-wal-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('WAL', () => {
  it('appends and recovers events', () => {
    const config = makeConfig();
    const events = [makeEvent('e1', 'first'), makeEvent('e2', 'second')];

    walAppend(events, config);
    const recovered = walRecover(config);

    expect(recovered).toHaveLength(2);
    expect(recovered[0]!.id).toBe('e1');
    expect(recovered[0]!.summary).toBe('first');
    expect(recovered[1]!.id).toBe('e2');
    expect(recovered[0]!.timestamp).toBeInstanceOf(Date);
  });

  it('removes processed events', () => {
    const config = makeConfig();
    walAppend([makeEvent('e1'), makeEvent('e2'), makeEvent('e3')], config);

    walRemove(new Set(['e1', 'e3']), config);

    const remaining = walRecover(config);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('e2');
  });

  it('returns empty array when no WAL exists', () => {
    expect(walRecover(makeConfig())).toEqual([]);
  });

  it('handles empty event list gracefully', () => {
    const config = makeConfig();
    walAppend([], config);
    expect(walRecover(config)).toEqual([]);
  });

  it('handles corrupt WAL lines gracefully', () => {
    const config = makeConfig();
    walAppend([makeEvent('e1')], config);

    // Inject a corrupt line
    const walFile = join(tempDir, 'events.wal');
    const content = readFileSync(walFile, 'utf-8');
    writeFileSync(walFile, 'NOT JSON\n' + content);

    const recovered = walRecover(config);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.id).toBe('e1');
  });

  it('supports multiple appends', () => {
    const config = makeConfig();
    walAppend([makeEvent('e1')], config);
    walAppend([makeEvent('e2')], config);

    const recovered = walRecover(config);
    expect(recovered).toHaveLength(2);
  });
});
