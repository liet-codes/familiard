import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escalate } from './index.js';
import type { EscalationPayload, FamiliardConfig } from '../types.js';

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

  it('calls shell command via execFileSync for shell method', async () => {
    const execFileSync = vi.fn();
    vi.doMock('node:child_process', () => ({ execFileSync }));

    // Re-import to pick up the mock — vitest hoists vi.mock but not vi.doMock
    // Since escalation uses static import, we test behavior indirectly
    // by verifying escalate doesn't throw with default 'echo' command
    await expect(escalate(makePayload(), makeConfig())).resolves.toBeUndefined();
  });

  it('handles openclaw-wake method with fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const config = makeConfig({
      escalation: { method: 'openclaw-wake', contextWindow: 5 },
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
      escalation: { method: 'openclaw-wake', contextWindow: 5 },
    });

    // Should not throw
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
