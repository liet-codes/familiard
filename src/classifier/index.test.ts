import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classify } from './index.js';
import type { EventBatch, FamiliardConfig } from '../types.js';

function makeConfig(overrides?: Partial<FamiliardConfig>): FamiliardConfig {
  return {
    model: 'test-model',
    intervalMs: 5000,
    confidenceThreshold: 0.6,
    watchers: [],
    escalation: { method: 'shell', contextWindow: 5 },
    journal: { path: '/tmp/test-journal' },
    ...overrides,
  };
}

function makeBatch(count = 2): EventBatch {
  return {
    events: Array.from({ length: count }, (_, i) => ({
      id: `evt-${i}`,
      source: 'test',
      type: 'test_event',
      timestamp: new Date('2026-02-17T04:00:00Z'),
      summary: `Test event ${i}`,
    })),
    batchedAt: new Date(),
  };
}

describe('classify', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty batch', async () => {
    const result = await classify({ events: [], batchedAt: new Date() }, makeConfig());
    expect(result.classifications).toEqual([]);
    expect(result.durationMs).toBe(0);
  });

  it('escalates everything when ollama is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }));
    const batch = makeBatch(2);
    const result = await classify(batch, makeConfig());

    expect(result.classifications).toHaveLength(2);
    for (const c of result.classifications) {
      expect(c.classification).toBe('escalate');
      expect(c.confidence).toBe(0);
    }
  });

  it('escalates everything on JSON parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'not valid json [[[' } }),
    }));
    const batch = makeBatch(1);
    const result = await classify(batch, makeConfig());

    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0]!.classification).toBe('escalate');
    expect(result.classifications[0]!.reason).toContain('parse error');
  });

  it('applies confidence threshold — low confidence escalates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([
            { classification: 'ignore', confidence: 0.3, reason: 'seems fine' },
          ]),
        },
      }),
    }));
    const batch = makeBatch(1);
    const result = await classify(batch, makeConfig({ confidenceThreshold: 0.6 }));

    expect(result.classifications[0]!.classification).toBe('escalate');
  });

  it('respects valid classification with high confidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([
            { classification: 'ignore', confidence: 0.9, reason: 'routine' },
            { classification: 'log', confidence: 0.8, reason: 'noted' },
          ]),
        },
      }),
    }));
    const batch = makeBatch(2);
    const result = await classify(batch, makeConfig());

    expect(result.classifications[0]!.classification).toBe('ignore');
    expect(result.classifications[1]!.classification).toBe('log');
  });

  it('handles fewer responses than events — extras escalated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([
            { classification: 'ignore', confidence: 0.9, reason: 'ok' },
          ]),
        },
      }),
    }));
    const batch = makeBatch(3);
    const result = await classify(batch, makeConfig());

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[0]!.classification).toBe('ignore');
    // Events without a response get empty object → escalate
    expect(result.classifications[1]!.classification).toBe('escalate');
    expect(result.classifications[2]!.classification).toBe('escalate');
  });

  it('treats unknown classification values as escalate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify([
            { classification: 'YOLO', confidence: 0.95, reason: 'idk' },
          ]),
        },
      }),
    }));
    const batch = makeBatch(1);
    const result = await classify(batch, makeConfig());

    expect(result.classifications[0]!.classification).toBe('escalate');
  });

  it('handles ollama returning object with classifications key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            classifications: [
              { classification: 'log', confidence: 0.85, reason: 'noted' },
            ],
          }),
        },
      }),
    }));
    const batch = makeBatch(1);
    const result = await classify(batch, makeConfig());

    expect(result.classifications[0]!.classification).toBe('log');
  });
});
