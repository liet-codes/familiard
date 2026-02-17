/**
 * Journal writer — appends classified events to daily markdown files.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JournalEntry, ClassifiedEvent, FamiliarEvent, FamiliardConfig } from '../types.js';

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function timeStr(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

function journalPath(config: FamiliardConfig, date: Date): string {
  return join(config.journal.path, `${dateStr(date)}.md`);
}

export function writeEntry(
  event: FamiliarEvent,
  classified: ClassifiedEvent,
  config: FamiliardConfig
): void {
  mkdirSync(config.journal.path, { recursive: true });

  const path = journalPath(config, event.timestamp);
  const tag = classified.classification === 'escalate' ? '🔴' : '📝';
  const line = `- ${timeStr(event.timestamp)} ${tag} [${event.source}/${event.type}] ${event.summary} — *${classified.reason}*\n`;

  // Add date header if file is new
  if (!existsSync(path)) {
    appendFileSync(path, `# ${dateStr(event.timestamp)}\n\n`);
  }

  appendFileSync(path, line);
}

/** Read recent journal entries for escalation context. */
export function recentEntries(config: FamiliardConfig, limit: number): JournalEntry[] {
  if (!existsSync(config.journal.path)) return [];

  const files = readdirSync(config.journal.path)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse();

  const entries: JournalEntry[] = [];

  for (const file of files) {
    if (entries.length >= limit) break;
    const content = readFileSync(join(config.journal.path, file), 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('- '));

    for (const line of lines.reverse()) {
      if (entries.length >= limit) break;
      // Parse: - HH:MM 🔴 [source/type] summary — *reason*
      const match = line.match(
        /^- (\d{2}:\d{2}) (?:🔴|📝) \[([^\]]+)\] (.+?) — \*(.+)\*$/
      );
      if (match) {
        const [, time, sourceType, summary, reason] = match;
        const [source, type] = sourceType!.split('/');
        const dateFromFile = file.replace('.md', '');
        entries.push({
          timestamp: new Date(`${dateFromFile}T${time}:00`),
          source: source!,
          type: type ?? 'unknown',
          summary: summary!,
          classification: line.includes('🔴') ? 'escalate' : 'log',
          reason: reason!,
        });
      }
    }
  }

  return entries;
}

/** Format journal entries for CLI display or escalation context. */
export function formatJournal(entries: JournalEntry[]): string {
  if (entries.length === 0) return 'No journal entries found.';

  return entries
    .map((e) => {
      const tag = e.classification === 'escalate' ? '🔴' : '📝';
      return `${timeStr(e.timestamp)} ${tag} [${e.source}/${e.type}] ${e.summary}`;
    })
    .join('\n');
}
