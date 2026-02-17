/**
 * Escalation — wakes a cloud agent when the classifier says something needs attention.
 *
 * Methods:
 * - shell: runs a command with templated context
 * - openclaw-wake: sends a wake event via OpenClaw's cron API
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
    case 'openclaw-wake':
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

function escalateShell(
  payload: EscalationPayload,
  config: FamiliardConfig
): void {
  const context = buildContext(payload);
  const summary = payload.events.map((e) => e.escalationSummary ?? e.reason).join('; ');

  // Use execFileSync to avoid shell injection. Command is split into program + args.
  // The default command uses env vars to pass data safely.
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

async function escalateOpenClaw(
  payload: EscalationPayload,
  _config: FamiliardConfig
): Promise<void> {
  // OpenClaw wake via cron API
  // TODO: discover OpenClaw gateway port and auth token from ~/.openclaw/openclaw.json
  const context = buildContext(payload);

  try {
    const res = await fetch('http://localhost:18789/api/cron/wake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: context,
        mode: 'now',
      }),
    });

    if (!res.ok) {
      console.error(`[escalation] openclaw wake failed: ${res.status}`);
    }
  } catch (err) {
    console.error(`[escalation] openclaw wake error:`, err);
  }
}
