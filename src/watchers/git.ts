/**
 * Git watcher — polls repos for new PRs and issues using `gh` CLI.
 * Uses async exec to avoid blocking the event loop.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { Watcher, FamiliarEvent } from '../types.js';

const execFileAsync = promisify(execFile);

export interface GitWatcherConfig {
  repos: string[];
  /** Events to watch for. Defaults to ['pr', 'issue']. */
  events?: Array<'pr' | 'issue'>;
  /** Poll interval in ms. Defaults to 60000. */
  pollMs?: number;
}

interface SeenState {
  lastPrId: number;
  lastIssueId: number;
}

async function gh(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function createGitWatcher(config: GitWatcherConfig): Watcher {
  const pending: FamiliarEvent[] = [];
  const seen = new Map<string, SeenState>();
  const events = config.events ?? ['pr', 'issue'];
  let interval: NodeJS.Timeout | null = null;
  let polling = false;

  async function pollRepo(repo: string) {
    const state = seen.get(repo) ?? { lastPrId: 0, lastIssueId: 0 };

    if (events.includes('pr')) {
      const prs = await gh([
        'pr', 'list', '--repo', repo, '--limit', '5',
        '--json', 'number,title,author,createdAt', '--state', 'open',
      ]);
      if (prs) {
        try {
          const list = JSON.parse(prs) as Array<{
            number: number;
            title: string;
            author: { login: string };
          }>;
          for (const pr of list) {
            if (pr.number > state.lastPrId) {
              pending.push({
                id: randomUUID(),
                source: `git/${repo.split('/').pop()}`,
                type: 'pr_opened',
                timestamp: new Date(),
                summary: `PR #${pr.number}: ${pr.title} (by ${pr.author.login})`,
              });
            }
          }
          if (list.length > 0) {
            state.lastPrId = Math.max(state.lastPrId, ...list.map((p) => p.number));
          }
        } catch { /* skip parse errors */ }
      }
    }

    if (events.includes('issue')) {
      const issues = await gh([
        'issue', 'list', '--repo', repo, '--limit', '5',
        '--json', 'number,title,author,createdAt', '--state', 'open',
      ]);
      if (issues) {
        try {
          const list = JSON.parse(issues) as Array<{
            number: number;
            title: string;
            author: { login: string };
          }>;
          for (const issue of list) {
            if (issue.number > state.lastIssueId) {
              pending.push({
                id: randomUUID(),
                source: `git/${repo.split('/').pop()}`,
                type: 'issue_opened',
                timestamp: new Date(),
                summary: `Issue #${issue.number}: ${issue.title} (by ${issue.author.login})`,
              });
            }
          }
          if (list.length > 0) {
            state.lastIssueId = Math.max(state.lastIssueId, ...list.map((i) => i.number));
          }
        } catch { /* skip parse errors */ }
      }
    }

    seen.set(repo, state);
  }

  return {
    name: 'git',

    async start() {
      // Seed state — get current highest IDs without generating events
      for (const repo of config.repos) {
        const state: SeenState = { lastPrId: 0, lastIssueId: 0 };

        const prs = await gh([
          'pr', 'list', '--repo', repo, '--limit', '5',
          '--json', 'number', '--state', 'open',
        ]);
        if (prs) {
          try {
            const list = JSON.parse(prs) as Array<{ number: number }>;
            if (list.length > 0) {
              state.lastPrId = Math.max(...list.map((p) => p.number));
            }
          } catch { /* skip */ }
        }

        const issues = await gh([
          'issue', 'list', '--repo', repo, '--limit', '5',
          '--json', 'number', '--state', 'open',
        ]);
        if (issues) {
          try {
            const list = JSON.parse(issues) as Array<{ number: number }>;
            if (list.length > 0) {
              state.lastIssueId = Math.max(...list.map((i) => i.number));
            }
          } catch { /* skip */ }
        }

        seen.set(repo, state);
        console.log(`[git] watching ${repo} (seeded: PR#${state.lastPrId}, Issue#${state.lastIssueId})`);
      }

      // Start polling with overlap guard
      interval = setInterval(async () => {
        if (polling) return; // skip if previous tick still running
        polling = true;
        try {
          for (const repo of config.repos) {
            await pollRepo(repo);
          }
        } catch (err) {
          console.error(`[git] poll error:`, err);
        } finally {
          polling = false;
        }
      }, config.pollMs ?? 60_000);

      return () => {
        if (interval) clearInterval(interval);
      };
    },

    flush(): FamiliarEvent[] {
      const flushed = [...pending];
      pending.length = 0;
      return flushed;
    },
  };
}
