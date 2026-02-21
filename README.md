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
git clone https://github.com/liet-codes/familiard.git
cd familiard
npm install

npm run dev -- init       # interactive setup wizard
npm run dev -- start      # start the daemon
npm run dev -- status     # check status
npm run dev -- journal    # view recent journal
```

Or build and link globally:

```bash
npm run build
npm link
familiard init
familiard start
```

## What It Does

1. **Watches** — filesystem changes, git repos (PRs, issues, pushes), and more
2. **Classifies** — local model triages each event: ignore / log / escalate
3. **Journals** — logs interesting events to daily markdown files (free, always)
4. **Escalates** — wakes your cloud agent with context when something needs real thinking

```
$ familiard journal
03:12 📝 [git/my-app] PR #47 merged by alice — routine merge, CI green
03:45 🔴 [git/my-app] 3 issues opened in 10 minutes — possible incident
04:01 📝 [fs/inbox] New file: meeting-notes.md — informational
05:30 🔴 [fs/inbox] New file: urgent-contract-v2.pdf — legal document, needs attention
```

When running interactively, you'll see a progress bar between ticks:

```
  ████████████░░░░░░░░ 36/60s
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

## Escalation Methods

familiard is send-only — it fires off the escalation and moves on. It doesn't wait for or process the response. Three methods are supported:

### OpenClaw

Wake your cloud agent directly via [OpenClaw](https://openclaw.ai)'s Gateway API. No polling, no intermediate services — pure push.

**1. Enable the HTTP endpoint on your OpenClaw gateway:**

```bash
openclaw config set gateway.http.endpoints.chatCompletions.enabled true
```

If familiard runs on a different machine than your gateway (the common case), you'll also need the gateway to listen on LAN:

```bash
openclaw config set gateway.bind lan
```

Restart the gateway after config changes:

```bash
openclaw gateway restart
```

**2. Get your gateway auth token:**

```bash
openclaw config get gateway.auth.token
```

**3. Configure familiard** (or run `familiard init` and select OpenClaw):

```yaml
# ~/.familiard/config.yaml
escalation:
  method: openclaw
  url: http://YOUR_GATEWAY_IP:18789   # gateway address (default port: 18789)
  token: YOUR_GATEWAY_TOKEN            # from step 2
  agentId: main                        # which agent to wake (default: main)
  contextWindow: 10                    # journal entries to include as context
```

**4. That's it.** When familiard escalates, your agent receives a message like:

> 🔴 familiard escalation
>
> • 3 issues opened on owner/repo in 10 minutes — possible incident
>
> Recent journal:
> 03:12 📝 PR #47 merged — routine
> 03:30 📝 New comment on issue #12
> 03:45 🔴 Issue #50 opened — bug report

Your agent processes it like any other message. What it *does* with the escalation is up to you and your agent's configuration. Some options:

- **Relay to you** — agent reads the escalation and DMs you on Discord/Telegram/etc. with a summary
- **Act autonomously** — agent handles it if it can (e.g., checking CI status, posting a response)
- **Log and move on** — agent notes it in memory for the next time you chat
- **Follow a playbook** — create a `FAMILIAR.md` (or similar) in your agent's workspace with rules for handling different event types

The simplest starting point: have your agent forward escalations to you. You'll naturally discover which events need automation and can build up rules over time.

### HTTP (generic webhook)

POST a JSON payload to any URL. Works with Discord webhooks, ntfy.sh, Home Assistant, Slack incoming webhooks, or any custom receiver.

```yaml
escalation:
  method: http
  url: https://your-endpoint.example.com/webhook
  headers:                              # optional
    Authorization: "Bearer ..."
  contextWindow: 10
```

Payload shape:

```json
{
  "source": "familiard",
  "timestamp": "2026-02-20T14:30:00Z",
  "events": [
    {
      "eventId": "...",
      "classification": "escalate",
      "reason": "3 issues opened in 10 minutes",
      "summary": "Possible incident on owner/repo",
      "confidence": 0.92
    }
  ],
  "context": "03:12 📝 PR #47 merged...\n03:45 🔴 Issue #50 opened..."
}
```

### Shell (local command)

Run any local command. Event data is passed via environment variables `$FAMILIARD_SUMMARY` and `$FAMILIARD_CONTEXT`.

```yaml
escalation:
  method: shell
  command: notify-send    # or any command — summary passed as first arg
  contextWindow: 10
```

## Configuration

Config lives at `~/.familiard/config.yaml`. Run `familiard init` to generate it interactively, or create it manually:

```yaml
# Ollama model for classification
model: llama3.1:8b-instruct

# How often to check for events (ms)
intervalMs: 60000

# Below this confidence, events escalate by default (fail safe)
confidenceThreshold: 0.7

# What to watch
watchers:
  - type: filesystem
    paths:
      - ~/Documents
    debounceMs: 2000

  - type: git
    repos:
      - owner/repo-name
    events: [pr, issue]
    pollMs: 60000

# Escalation (see methods above)
escalation:
  method: openclaw
  url: http://192.168.1.30:18789
  token: your-token
  agentId: main
  contextWindow: 10

# Journal location
journal:
  path: ~/.familiard/journal

# Helps the classifier understand what matters to you
userContext: "Software engineer working on distributed systems"
```

## Architecture

```
familiard
  ├── watchers/          Event sources (filesystem, git, http, email)
  ├── classifier/        Local model triage via ollama
  ├── journal/           Daily markdown logs
  └── escalation/        Wake cloud agents (shell, http, openclaw)
```

The daemon loop:

```
           ┌──────────┐
           │ Watchers  │ ← filesystem, git, http, email
           └────┬─────┘
                │ raw events
           ┌────▼─────┐
           │Classifier │ ← local ollama model
           └────┬─────┘
                │ ignore / log / escalate
         ┌──────┼──────┐
         │      │      │
      ignore  log   escalate
              │      │
           journal  cloud agent
```

## Ancestry

- [nerds.ai](https://github.com/mbilokonsky/nerds.ai) (2024) — composable LLM interfaces with typed output and tool delegation, 18 months before these became standard
- [OpenClaw](https://openclaw.ai) heartbeat system — the polling pattern familiard inverts

## License

MIT
