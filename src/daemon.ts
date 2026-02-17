/**
 * The daemon loop — the heart of familiard.
 *
 * Every intervalMs:
 *   1. Flush all watchers → collect events
 *   2. If events exist → classify batch
 *   3. Write LOG and ESCALATE events to journal
 *   4. If any ESCALATE events → escalate to cloud agent
 */

import type { Watcher, FamiliardConfig, DaemonStatus, FamiliarEvent } from './types.js';
import { classify } from './classifier/index.js';
import { writeEntry, recentEntries } from './journal/index.js';
import { escalate } from './escalation/index.js';

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

  // Main loop
  const loop = setInterval(async () => {
    try {
      // 1. Flush all watchers
      const allEvents: FamiliarEvent[] = [];
      for (const watcher of watchers) {
        const events = watcher.flush();
        allEvents.push(...events);
      }

      if (allEvents.length === 0) return;

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

        // Write to journal (both LOG and ESCALATE)
        writeEntry(event, classified, config);

        if (classified.classification === 'log') {
          status.eventsLogged++;
        } else if (classified.classification === 'escalate') {
          status.eventsEscalated++;
          toEscalate.push(classified);
        }
      }

      status.lastClassification = new Date();

      // 4. Escalate if needed
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
    } catch (err) {
      console.error('[familiard] loop error:', err);
    }
  }, config.intervalMs);

  // Return cleanup function
  return () => {
    status.running = false;
    clearInterval(loop);
    for (const cleanup of cleanups) cleanup();
    console.log(
      `[familiard] stopped. Processed ${status.eventsProcessed} events ` +
      `(${status.eventsEscalated} escalated, ${status.eventsLogged} logged).`
    );
  };
}
