/**
 * Git watcher — polls repos for new commits, PRs, and issues using `gh` CLI.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Watcher, FamiliarEvent } from '../types.js';

export interface GitWatcherConfig {
  repos: string[];
  /** Events to watch for. Defaults to all. */
  events?: Array<'push' | 'pr' | 'issue'>;
  /** Poll interval in ms. Defaults to 60000. */
  pollMs?: number;
}

interface SeenState {
  lastCommit?: string;
  lastPrId?: number;
  lastIssueId?: number;
}

export function createGitWatcher(config: GitWatcherConfig): Watcher {
  const pending: FamiliarEvent[] = [];
  const seen = new Map<string, SeenState>();
  const events = config.events ?? ['push', 'pr', 'issue'];
  let interval: NodeJS.Timeout | null = null;

  function ghExec(args: string): string | null {
    try {
      return execSync(`gh ${args}`, {
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  }

  function pollRepo(repo: string) {
    const state = seen.get(repo) ?? {};

    if (events.includes('pr')) {
      const prs = ghExec(
        `pr list --repo ${repo} --limit 5 --json number,title,author,createdAt --state open`
      );
      if (prs) {
        try {
          const list = JSON.parse(prs) as Array<{
            number: number;
            title: string;
            author: { login: string };
          }>;
          for (const pr of list) {
            if (!state.lastPrId || pr.number > state.lastPrId) {
              pending.push({
                id: randomUUID(),
                source: `git/${repo.split('/').pop()}`,
                type: 'pr_opened',
                timestamp: new Date(),
                summary: `PR #${pr.number}: ${pr.title} (by ${pr.author.login})`,
                raw: { repo, pr },
              });
            }
          }
          if (list.length > 0) {
            state.lastPrId = Math.max(...list.map((p) => p.number));
          }
        } catch { /* skip */ }
      }
    }

    if (events.includes('issue')) {
      const issues = ghExec(
        `issue list --repo ${repo} --limit 5 --json number,title,author,createdAt --state open`
      );
      if (issues) {
        try {
          const list = JSON.parse(issues) as Array<{
            number: number;
            title: string;
            author: { login: string };
          }>;
          for (const issue of list) {
            if (!state.lastIssueId || issue.number > state.lastIssueId) {
              pending.push({
                id: randomUUID(),
                source: `git/${repo.split('/').pop()}`,
                type: 'issue_opened',
                timestamp: new Date(),
                summary: `Issue #${issue.number}: ${issue.title} (by ${issue.author.login})`,
                raw: { repo, issue },
              });
            }
          }
          if (list.length > 0) {
            state.lastIssueId = Math.max(...list.map((i) => i.number));
          }
        } catch { /* skip */ }
      }
    }

    seen.set(repo, state);
  }

  return {
    name: 'git',

    async start() {
      // Initial poll to seed the "seen" state (don't generate events for existing items)
      for (const repo of config.repos) {
        try {
          // Seed PR state
          const prs = ghExec(`pr list --repo ${repo} --limit 1 --json number`);
          if (prs) {
            const list = JSON.parse(prs) as Array<{ number: number }>;
            if (list.length > 0) {
              const state = seen.get(repo) ?? {};
              state.lastPrId = list[0]!.number;
              seen.set(repo, state);
            }
          }
          // Seed issue state
          const issues = ghExec(`issue list --repo ${repo} --limit 1 --json number`);
          if (issues) {
            const list = JSON.parse(issues) as Array<{ number: number }>;
            if (list.length > 0) {
              const state = seen.get(repo) ?? {};
              state.lastIssueId = list[0]!.number;
              seen.set(repo, state);
            }
          }
          console.log(`[git] watching ${repo}`);
        } catch {
          console.error(`[git] failed to seed state for ${repo}`);
        }
      }

      // Start polling
      interval = setInterval(() => {
        for (const repo of config.repos) {
          pollRepo(repo);
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
