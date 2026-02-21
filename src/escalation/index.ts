/**
 * Escalation — wakes a cloud agent when the classifier says something needs attention.
 *
 * Methods:
 * - shell:    runs a local command with event context in env vars
 * - http:     POST JSON to any webhook URL (generic)
 * - openclaw: wake an OpenClaw agent via the Gateway's OpenAI-compatible HTTP API
 */

import { execFileSync } from 'node:child_process';
import type {
  EscalationPayload,
  FamiliardConfig,
  JournalEntry,
} from '../types.js';
import { formatJournal } from '../journal/index.js';

export async function escalate(
  payload: EscalationPayload,
  config: FamiliardConfig
): Promise<void> {
  const { method } = config.escalation;

  switch (method) {
    case 'shell':
      return escalateShell(payload, config);
    case 'http':
      return escalateHttp(payload, config);
    case 'openclaw':
      return escalateOpenClaw(payload, config);
    default:
      console.error(`[escalation] unknown method: ${method}`);
  }
}

function buildContext(payload: EscalationPayload): string {
  const eventSummaries = payload.events
    .map((e) => `- ${e.escalationSummary ?? e.reason}`)
    .join('\n');

  const journal = payload.journalContext.length > 0
    ? `\nRecent activity:\n${formatJournal(payload.journalContext)}`
    : '';

  return `familiard escalation at ${payload.triggeredAt.toISOString()}

Events requiring attention:
${eventSummaries}
${journal}`;
}

function buildMessage(payload: EscalationPayload): string {
  const summaries = payload.events
    .map((e) => e.escalationSummary ?? e.reason)
    .join('\n• ');

  const journal = payload.journalContext.length > 0
    ? `\n\nRecent journal:\n${formatJournal(payload.journalContext)}`
    : '';

  return `🔴 familiard escalation\n\n• ${summaries}${journal}`;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function escalateShell(
  payload: EscalationPayload,
  config: FamiliardConfig
): void {
  const context = buildContext(payload);
  const summary = payload.events.map((e) => e.escalationSummary ?? e.reason).join('; ');
  const command = config.escalation.command ?? 'echo';

  try {
    execFileSync(command, [summary], {
      stdio: 'inherit',
      timeout: 30_000,
      env: {
        ...process.env,
        FAMILIARD_SUMMARY: summary,
        FAMILIARD_CONTEXT: context,
      },
    });
  } catch (err) {
    console.error(`[escalation] shell command failed:`, err);
  }
}

// ─── HTTP (generic webhook) ──────────────────────────────────────────────────

async function escalateHttp(
  payload: EscalationPayload,
  config: FamiliardConfig
): Promise<void> {
  const url = config.escalation.url;
  if (!url) {
    console.error('[escalation] http method requires escalation.url in config');
    return;
  }

  const body = {
    source: 'familiard',
    timestamp: payload.triggeredAt.toISOString(),
    events: payload.events.map((e) => ({
      eventId: e.eventId,
      classification: e.classification,
      reason: e.reason,
      summary: e.escalationSummary ?? e.reason,
      confidence: e.confidence,
    })),
    context: payload.journalContext.length > 0
      ? formatJournal(payload.journalContext)
      : null,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.escalation.headers,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`[escalation] http POST to ${url} failed: ${res.status}`);
    } else {
      console.log(`[escalation] http POST to ${url} — ${res.status}`);
    }
  } catch (err) {
    console.error(`[escalation] http error:`, err);
  }
}

// ─── OpenClaw (Gateway chat completions API) ────────────────────────────────

async function escalateOpenClaw(
  payload: EscalationPayload,
  config: FamiliardConfig
): Promise<void> {
  const gatewayUrl = config.escalation.url;
  const token = config.escalation.token;

  if (!gatewayUrl) {
    console.error('[escalation] openclaw method requires escalation.url (gateway URL, e.g. http://192.168.1.30:18789)');
    return;
  }
  if (!token) {
    console.error('[escalation] openclaw method requires escalation.token (gateway auth token)');
    return;
  }

  const endpoint = `${gatewayUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const message = buildMessage(payload);
  const agentId = config.escalation.agentId ?? 'main';

  const body = {
    model: `openclaw:${agentId}`,
    user: 'familiard',  // stable session key
    messages: [
      { role: 'user', content: message },
    ],
  };

  // Fire-and-forget: we only care that the gateway accepted the request.
  // Use AbortController to stop waiting once we get headers back.
  const controller = new AbortController();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[escalation] openclaw gateway returned ${res.status}: ${text}`);
    } else {
      console.log(`[escalation] openclaw agent woken — ${res.status} (not waiting for completion)`);
      // Abort reading the response body — we don't need the agent's reply
      controller.abort();
    }
  } catch (err: any) {
    // Ignore AbortError — that's us intentionally disconnecting
    if (err?.name === 'AbortError') return;
    console.error(`[escalation] openclaw error:`, err);
  }
}
