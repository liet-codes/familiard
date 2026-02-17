/**
 * Write-ahead log (WAL) for event durability.
 *
 * Events are appended to a JSONL file when flushed from watchers.
 * After successful classification + journaling, processed events are removed.
 * On startup, any events left in the WAL are recovered and re-processed.
 *
 * This prevents event loss if the process crashes between flush and classify.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { FamiliarEvent, FamiliardConfig } from './types.js';

function walPath(config: FamiliardConfig): string {
  return join(dirname(config.journal.path), 'events.wal');
}

/** Serialize an event for the WAL. Dates become ISO strings. */
function serialize(event: FamiliarEvent): string {
  return JSON.stringify({
    ...event,
    timestamp: event.timestamp.toISOString(),
  });
}

/** Deserialize a WAL line back to a FamiliarEvent. */
function deserialize(line: string): FamiliarEvent | null {
  try {
    const raw = JSON.parse(line);
    return {
      ...raw,
      timestamp: new Date(raw.timestamp),
    };
  } catch {
    return null;
  }
}

/** Append events to the WAL. Call after flushing watchers, before classifying. */
export function walAppend(events: FamiliarEvent[], config: FamiliardConfig): void {
  if (events.length === 0) return;
  const path = walPath(config);
  mkdirSync(dirname(path), { recursive: true });
  const lines = events.map(serialize).join('\n') + '\n';
  appendFileSync(path, lines);
}

/** Remove processed event IDs from the WAL. Call after successful classification. */
export function walRemove(processedIds: Set<string>, config: FamiliardConfig): void {
  const path = walPath(config);
  if (!existsSync(path)) return;

  const content = readFileSync(path, 'utf-8');
  const remaining = content
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      const event = deserialize(line);
      return event !== null && !processedIds.has(event.id);
    })
    .join('\n');

  writeFileSync(path, remaining ? remaining + '\n' : '');
}

/** Recover unprocessed events from the WAL. Call on startup. */
export function walRecover(config: FamiliardConfig): FamiliarEvent[] {
  const path = walPath(config);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf-8');
  const events: FamiliarEvent[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const event = deserialize(line);
    if (event) events.push(event);
  }

  if (events.length > 0) {
    console.log(`[wal] recovered ${events.length} unprocessed event(s)`);
  }

  return events;
}
