/**
 * The daemon loop — the heart of familiard.
 *
 * Every intervalMs:
 *   1. Flush all watchers → collect events
 *   2. If events exist → classify batch
 *   3. Write LOG and ESCALATE events to journal
 *   4. If any ESCALATE events → escalate to cloud agent
 *
 * Uses setTimeout chaining (not setInterval) to prevent overlapping runs.
 * Includes exponential backoff on consecutive errors to avoid escalation storms.
 */

import type { Watcher, FamiliardConfig, DaemonStatus, FamiliarEvent } from './types.js';
import { classify } from './classifier/index.js';
import { writeEntry, recentEntries } from './journal/index.js';
import { escalate } from './escalation/index.js';
import { writePid, clearPid } from './status.js';
import { walAppend, walRemove, walRecover } from './wal.js';

const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes max backoff

export async function runDaemon(
  watchers: Watcher[],
  config: FamiliardConfig
): Promise<() => void> {
  const status: DaemonStatus = {
    running: true,
    pid: process.pid,
    startedAt: new Date(),
    eventsProcessed: 0,
    eventsEscalated: 0,
    eventsLogged: 0,
    watcherCount: watchers.length,
  };

  writePid();

  // Start all watchers
  const cleanups: Array<() => void> = [];
  for (const watcher of watchers) {
    const cleanup = await watcher.start();
    cleanups.push(cleanup);
  }

  console.log(
    `[familiard] running with ${watchers.length} watcher(s), ` +
    `interval ${config.intervalMs / 1000}s, model ${config.model}`
  );

  // Recover any events from a previous crash
  const recovered = walRecover(config);

  let consecutiveErrors = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (!status.running) return;

    try {
      // 1. Flush all watchers
      const allEvents: FamiliarEvent[] = [];

      // Include recovered events on first tick (already in WAL — don't re-append)
      const recoveredBatch = recovered.splice(0);

      for (const watcher of watchers) {
        const events = watcher.flush();
        allEvents.push(...events);
      }

      // Only append NEW events to WAL (recovered ones are already there)
      walAppend(allEvents, config);

      // Now add recovered events to the processing batch
      allEvents.unshift(...recoveredBatch);

      if (allEvents.length > 0) {
        console.log(`[familiard] processing ${allEvents.length} event(s)...`);

        // 2. Classify
        const result = await classify(
          { events: allEvents, batchedAt: new Date() },
          config
        );

        // 3. Journal + collect escalations
        const toEscalate = [];

        for (let i = 0; i < allEvents.length; i++) {
          const event = allEvents[i]!;
          const classified = result.classifications[i]!;
          status.eventsProcessed++;

          if (classified.classification === 'ignore') continue;

          writeEntry(event, classified, config);

          if (classified.classification === 'log') {
            status.eventsLogged++;
          } else if (classified.classification === 'escalate') {
            status.eventsEscalated++;
            toEscalate.push(classified);
          }
        }

        status.lastClassification = new Date();

        // 4. Escalate if needed (before WAL cleanup — crash during escalate should retry)
        if (toEscalate.length > 0) {
          console.log(`[familiard] escalating ${toEscalate.length} event(s)`);
          const context = recentEntries(config, config.escalation.contextWindow);
          await escalate(
            {
              events: toEscalate,
              journalContext: context,
              triggeredAt: new Date(),
            },
            config
          );
        }

        // Remove processed events from WAL (after escalation succeeds)
        walRemove(new Set(allEvents.map((e) => e.id)), config);
      }

      // Success — reset backoff
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`[familiard] loop error (attempt ${consecutiveErrors}):`, err);
    }

    // Schedule next tick — with backoff on errors
    if (status.running) {
      const backoff = consecutiveErrors > 0
        ? Math.min(config.intervalMs * Math.pow(2, consecutiveErrors - 1), MAX_BACKOFF_MS)
        : config.intervalMs;
      timer = setTimeout(tick, backoff);
    }
  }

  // Start the loop
  timer = setTimeout(tick, config.intervalMs);

  // Return cleanup function
  return () => {
    status.running = false;
    if (timer) clearTimeout(timer);
    for (const cleanup of cleanups) cleanup();
    clearPid();
    console.log(
      `[familiard] stopped. Processed ${status.eventsProcessed} events ` +
      `(${status.eventsEscalated} escalated, ${status.eventsLogged} logged).`
    );
  };
}
