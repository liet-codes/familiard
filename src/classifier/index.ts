/**
 * Event classifier using a local ollama model.
 *
 * The classifier is the core of familiard. It takes a batch of events
 * and returns classifications: ignore, log, or escalate.
 *
 * Key design decisions (from reviewer consensus):
 * - Aggressive escalation bias: confidence < threshold → escalate by default
 * - Structured JSON output from the model
 * - Privacy-safe escalation summaries (no raw data forwarded)
 */

import type {
  EventBatch,
  ClassificationResult,
  ClassifiedEvent,
  FamiliardConfig,
  FamiliarEvent,
} from '../types.js';

const SYSTEM_PROMPT = `You are a triage daemon. You classify events by importance.

For each event, return a JSON classification:
- "ignore": routine, not interesting, no action needed
- "log": worth recording but doesn't need cloud-grade thinking
- "escalate": needs attention — urgent, complex, or requires action from a more capable agent

Also return:
- "confidence": 0.0 to 1.0, how certain you are of this classification
- "reason": one-line explanation
- "escalationSummary": (only for escalate) a privacy-safe summary suitable for sending to a cloud agent. Do NOT include raw file contents, email bodies, or sensitive data — summarize the nature and urgency.

Respond ONLY with a JSON array. No markdown, no explanation.`;

function buildUserPrompt(events: FamiliarEvent[], userContext?: string): string {
  const lines = events.map(
    (e) => `[${e.source}/${e.type}] ${e.summary}`
  );

  let prompt = `Classify these events:\n\n${lines.join('\n')}`;
  if (userContext) {
    prompt = `User context: ${userContext}\n\n${prompt}`;
  }
  return prompt;
}

interface OllamaResponse {
  message?: { content?: string };
}

export async function classify(
  batch: EventBatch,
  config: FamiliardConfig
): Promise<ClassificationResult> {
  const start = Date.now();

  if (batch.events.length === 0) {
    return { classifications: [], durationMs: 0, model: config.model };
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(batch.events, config.userContext) },
    ],
    format: 'json',
    stream: false,
  };

  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Ollama is down or model not loaded — escalate everything (fail-safe)
    console.error(`[classifier] ollama error: ${res.status} ${res.statusText}`);
    return {
      classifications: batch.events.map((e) => ({
        eventId: e.id,
        classification: 'escalate' as const,
        confidence: 0,
        reason: 'classifier unavailable — escalating by default',
        escalationSummary: e.summary,
      })),
      durationMs: Date.now() - start,
      model: config.model,
    };
  }

  const data = (await res.json()) as OllamaResponse;
  const content = data.message?.content ?? '[]';

  let parsed: Array<{
    classification?: string;
    confidence?: number;
    reason?: string;
    escalationSummary?: string;
  }>;
  try {
    const raw = JSON.parse(content);
    parsed = Array.isArray(raw) ? raw : raw.classifications ?? [raw];
  } catch {
    // JSON parse failure — escalate everything (fail-safe)
    console.error(`[classifier] failed to parse response: ${content.slice(0, 200)}`);
    return {
      classifications: batch.events.map((e) => ({
        eventId: e.id,
        classification: 'escalate' as const,
        confidence: 0,
        reason: 'classifier parse error — escalating by default',
        escalationSummary: e.summary,
      })),
      durationMs: Date.now() - start,
      model: config.model,
    };
  }

  // Map responses back to events, applying confidence threshold
  const classifications: ClassifiedEvent[] = batch.events.map((event, i) => {
    const c = parsed[i] ?? {};
    const confidence = typeof c.confidence === 'number' ? c.confidence : 0;
    let classification = c.classification as ClassifiedEvent['classification'] ?? 'escalate';

    // Aggressive escalation bias: low confidence → escalate
    if (confidence < config.confidenceThreshold && classification !== 'escalate') {
      classification = 'escalate';
    }

    return {
      eventId: event.id,
      classification,
      confidence,
      reason: c.reason ?? 'no reason given',
      escalationSummary: classification === 'escalate'
        ? (c.escalationSummary ?? event.summary)
        : undefined,
    };
  });

  return {
    classifications,
    durationMs: Date.now() - start,
    model: config.model,
  };
}
