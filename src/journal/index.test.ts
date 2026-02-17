import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeEntry, recentEntries, formatJournal } from './index.js';
import type { FamiliardConfig, FamiliarEvent, ClassifiedEvent, JournalEntry } from '../types.js';

let tempDir: string;

function makeConfig(): FamiliardConfig {
  return {
    model: 'test',
    intervalMs: 5000,
    confidenceThreshold: 0.6,
    watchers: [],
    escalation: { method: 'shell', contextWindow: 5 },
    journal: { path: tempDir },
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'familiard-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('writeEntry', () => {
  it('creates date-headed file and writes entry', () => {
    const event: FamiliarEvent = {
      id: 'e1',
      source: 'git',
      type: 'pr_opened',
      timestamp: new Date('2026-02-17T10:30:00Z'),
      summary: 'New PR from alice',
    };
    const classified: ClassifiedEvent = {
      eventId: 'e1',
      classification: 'log',
      confidence: 0.9,
      reason: 'routine PR',
    };

    writeEntry(event, classified, makeConfig());

    const content = readFileSync(join(tempDir, '2026-02-17.md'), 'utf-8');
    expect(content).toContain('# 2026-02-17');
    expect(content).toContain('📝 [git/pr_opened] New PR from alice — *routine PR*');
  });

  it('uses 🔴 for escalated events', () => {
    const event: FamiliarEvent = {
      id: 'e2',
      source: 'email',
      type: 'new',
      timestamp: new Date('2026-02-17T11:00:00Z'),
      summary: 'Urgent from boss',
    };
    const classified: ClassifiedEvent = {
      eventId: 'e2',
      classification: 'escalate',
      confidence: 0.4,
      reason: 'urgent keyword',
      escalationSummary: 'Urgent email received',
    };

    writeEntry(event, classified, makeConfig());

    const content = readFileSync(join(tempDir, '2026-02-17.md'), 'utf-8');
    expect(content).toContain('🔴');
  });
});

describe('recentEntries', () => {
  it('returns empty for nonexistent dir', () => {
    const config = makeConfig();
    config.journal.path = '/tmp/nonexistent-familiard-test-xyz';
    expect(recentEntries(config, 10)).toEqual([]);
  });

  it('parses written entries back', () => {
    const event: FamiliarEvent = {
      id: 'e1',
      source: 'git',
      type: 'push',
      timestamp: new Date('2026-02-17T14:30:00'),
      summary: 'Pushed to main',
    };
    const classified: ClassifiedEvent = {
      eventId: 'e1',
      classification: 'log',
      confidence: 0.85,
      reason: 'routine push',
    };

    writeEntry(event, classified, makeConfig());
    const entries = recentEntries(makeConfig(), 10);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe('git');
    expect(entries[0]!.type).toBe('push');
    expect(entries[0]!.summary).toBe('Pushed to main');
    expect(entries[0]!.classification).toBe('log');
  });
});

describe('formatJournal', () => {
  it('returns placeholder for empty entries', () => {
    expect(formatJournal([])).toBe('No journal entries found.');
  });

  it('formats entries with tags', () => {
    const entries: JournalEntry[] = [
      {
        timestamp: new Date('2026-02-17T09:00:00'),
        source: 'git',
        type: 'pr',
        summary: 'New PR',
        classification: 'escalate',
        reason: 'needs review',
      },
    ];
    const output = formatJournal(entries);
    expect(output).toContain('🔴');
    expect(output).toContain('[git/pr]');
  });
});
