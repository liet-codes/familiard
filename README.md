# familiard

> The local inference daemon. Watches your world, wakes your cloud agent only when it matters.

## The Problem

Cloud agents (OpenClaw, Claude Code, Cline) are powerful but wasteful. They run periodic heartbeats — polling loops that burn expensive tokens checking if anything happened. 90% of the time, nothing did.

Meanwhile, real events wait up to 30 minutes to be noticed.

## The Inversion

```
BEFORE:  Cloud model (expensive) → heartbeat every 30m → usually nothing → $$$
AFTER:   Local model (free) → check every 60s → escalate only when needed → $
```

familiard runs a small local model (via [ollama](https://ollama.ai)) that continuously monitors your configured sources. It classifies each event as **ignore**, **log**, or **escalate**. Only escalations wake your cloud agent — with rich context from the journal.

## Quick Start

```bash
npm install -g familiard
familiard init    # detects ollama, asks what to watch, writes config
familiard start   # starts the daemon
```

## What It Does

1. **Watches** — filesystem changes, git repos (PRs, issues, pushes), and more
2. **Classifies** — local model triages each event: ignore / log / escalate
3. **Journals** — logs interesting events to daily markdown files (free, always)
4. **Escalates** — wakes your cloud agent with context when something needs real thinking

```bash
$ familiard journal
03:12 📝 [git/my-app] PR #47 merged by alice — routine merge, CI green
03:45 🔴 [git/my-app] 3 issues opened in 10 minutes — possible incident
04:01 📝 [fs/inbox] New file: meeting-notes.md — informational
05:30 🔴 [fs/inbox] New file: urgent-contract-v2.pdf — legal document, needs attention
```

## Requirements

- Node.js ≥ 20
- [ollama](https://ollama.ai) with a model pulled (default: `llama3.1:8b-instruct`)
- macOS or Linux

## Design Philosophy

- **Fail safe**: if the classifier is uncertain, it escalates. Noisy → quiet, never quiet → missed.
- **Privacy by default**: raw event data stays local. Only summaries reach the cloud.
- **Zero config to start**: `familiard init` detects your environment and sets up sensible defaults.
- **The classifier is the product**: anyone can write a cron job that polls. The local model *understanding* whether an event matters is the differentiator.

## Architecture

```
familiard
  ├── watchers/          Event sources (filesystem, git, http, email)
  ├── classifier/        Local model triage via ollama
  ├── journal/           Daily markdown logs
  └── escalation/        Wake cloud agents (shell, OpenClaw)
```

## Ancestry

- [nerds.ai](https://github.com/mbilokonsky/nerds.ai) (2024) — composable LLM interfaces with typed output and tool delegation, 18 months before these became standard
- [OpenClaw](https://openclaw.ai) heartbeat system — the polling pattern familiard inverts

## License

MIT
