import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escalate } from './index.js';
import type { EscalationPayload, FamiliardConfig } from '../types.js';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

function makeConfig(overrides?: Partial<FamiliardConfig>): FamiliardConfig {
  return {
    model: 'test',
    intervalMs: 5000,
    confidenceThreshold: 0.6,
    watchers: [],
    escalation: { method: 'shell', contextWindow: 5 },
    journal: { path: '/tmp/test' },
    ...overrides,
  };
}

function makePayload(): EscalationPayload {
  return {
    events: [
      {
        eventId: 'e1',
        classification: 'escalate',
        confidence: 0.3,
        reason: 'urgent',
        escalationSummary: 'Something urgent happened',
      },
    ],
    journalContext: [],
    triggeredAt: new Date('2026-02-17T04:00:00Z'),
  };
}

describe('escalate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls execFileSync with summary as arg for shell method', async () => {
    await escalate(makePayload(), makeConfig());

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'echo',
      ['Something urgent happened'],
      expect.objectContaining({
        timeout: 30_000,
        env: expect.objectContaining({
          FAMILIARD_SUMMARY: 'Something urgent happened',
        }),
      })
    );
  });

  it('uses custom command from config', async () => {
    const config = makeConfig({
      escalation: { method: 'shell', command: '/usr/bin/notify', contextWindow: 5 },
    });
    await escalate(makePayload(), config);

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      '/usr/bin/notify',
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('handles execFileSync throwing gracefully', async () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('command not found');
    });

    // Should not throw
    await expect(escalate(makePayload(), makeConfig())).resolves.toBeUndefined();
  });

  it('handles openclaw-wake method with fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const config = makeConfig({
      escalation: { method: 'openclaw', contextWindow: 5 },
    });

    await escalate(makePayload(), config);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:18789/api/cron/wake',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('handles openclaw-wake fetch failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const config = makeConfig({
      escalation: { method: 'openclaw', contextWindow: 5 },
    });

    await expect(escalate(makePayload(), config)).resolves.toBeUndefined();
  });

  it('logs error for unknown method', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = makeConfig({
      escalation: { method: 'carrier-pigeon' as any, contextWindow: 5 },
    });

    await escalate(makePayload(), config);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown method'));
  });
});
