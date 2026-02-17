/**
 * Filesystem watcher — watches directories for file changes.
 * Uses Node's native fs.watch with debounce to batch rapid changes.
 */

import { watch, type FSWatcher } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Watcher, FamiliarEvent } from '../types.js';

export interface FilesystemWatcherConfig {
  paths: string[];
  /** Debounce window in ms. Defaults to 2000. */
  debounceMs?: number;
}

export function createFilesystemWatcher(
  config: FilesystemWatcherConfig
): Watcher {
  const pending = new Map<string, FamiliarEvent>();
  const watchers: FSWatcher[] = [];
  const debounceMs = config.debounceMs ?? 2000;
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  function handleChange(watchedPath: string, eventType: string, filename: string | null) {
    if (!filename) return;

    const fullPath = join(watchedPath, filename);
    const key = `${eventType}:${fullPath}`;

    // Debounce: reset timer for this file
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        const type = eventType === 'rename' ? 'file_created' : 'file_modified';
        pending.set(key, {
          id: randomUUID(),
          source: 'filesystem',
          type,
          timestamp: new Date(),
          summary: `${type}: ${relative(watchedPath, fullPath) || filename}`,
          raw: { path: fullPath, watchedPath, eventType },
        });
      }, debounceMs)
    );
  }

  return {
    name: 'filesystem',

    async start() {
      for (const p of config.paths) {
        try {
          const w = watch(p, { recursive: true }, (eventType, filename) => {
            handleChange(p, eventType, filename);
          });
          watchers.push(w);
          console.log(`[filesystem] watching ${p}`);
        } catch (err) {
          console.error(`[filesystem] failed to watch ${p}:`, err);
        }
      }

      return () => {
        for (const w of watchers) w.close();
        for (const t of debounceTimers.values()) clearTimeout(t);
        watchers.length = 0;
        debounceTimers.clear();
      };
    },

    flush(): FamiliarEvent[] {
      const events = Array.from(pending.values());
      pending.clear();
      return events;
    },
  };
}
