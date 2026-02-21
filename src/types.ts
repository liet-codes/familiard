/**
 * Core types for familiard.
 *
 * Everything flows from the Event schema:
 *   Watcher produces Events → Classifier classifies them → Journal logs them → Escalator acts on them.
 */

// ─── Events ───────────────────────────────────────────────────────────────────

/** Raw event produced by a watcher. */
export interface FamiliarEvent {
  /** Unique event ID (ulid or uuid). */
  id: string;
  /** Which watcher produced this event. */
  source: string;
  /** Event type within the source (e.g., "push", "file_created", "new_email"). */
  type: string;
  /** When the event occurred. */
  timestamp: Date;
  /** Human-readable one-line summary. */
  summary: string;
  /** Raw event data — watcher-specific, never sent to cloud unless explicitly requested. */
  raw?: unknown;
}

/** A batch of events ready for classification. */
export interface EventBatch {
  /** Events in this batch. */
  events: FamiliarEvent[];
  /** When the batch was assembled. */
  batchedAt: Date;
}

// ─── Classification ───────────────────────────────────────────────────────────

export type Classification = 'ignore' | 'log' | 'escalate';

/** Result of classifying a single event. */
export interface ClassifiedEvent {
  /** Original event ID. */
  eventId: string;
  /** Classification decision. */
  classification: Classification;
  /** Classifier's confidence (0-1). Below threshold → escalate by default. */
  confidence: number;
  /** One-line reason for the classification. */
  reason: string;
  /** Privacy-safe summary for escalation (no raw data). */
  escalationSummary?: string;
}

/** Result of classifying a batch. */
export interface ClassificationResult {
  classifications: ClassifiedEvent[];
  /** How long the classifier took (ms). */
  durationMs: number;
  /** Model used. */
  model: string;
}

// ─── Journal ──────────────────────────────────────────────────────────────────

/** A single journal entry (written to daily markdown files). */
export interface JournalEntry {
  timestamp: Date;
  source: string;
  type: string;
  summary: string;
  classification: Classification;
  reason: string;
}

// ─── Escalation ───────────────────────────────────────────────────────────────

export type EscalationMethod = 'shell' | 'http' | 'openclaw';

export interface EscalationPayload {
  /** Events being escalated. */
  events: ClassifiedEvent[];
  /** Recent journal context (last N entries). */
  journalContext: JournalEntry[];
  /** When the escalation was triggered. */
  triggeredAt: Date;
}

// ─── Watchers ─────────────────────────────────────────────────────────────────

/** Interface all watchers implement. */
export interface Watcher {
  /** Unique name for this watcher instance. */
  name: string;
  /** Start watching. Returns cleanup function. */
  start(): Promise<() => void>;
  /** Flush any pending events (called by the batch timer). */
  flush(): FamiliarEvent[];
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface WatcherConfig {
  type: 'filesystem' | 'git' | 'http' | 'email';
  name?: string;
  /** Watcher-specific options. */
  [key: string]: unknown;
}

export interface FamiliardConfig {
  /** Ollama model to use for classification. */
  model: string;
  /** How often to run the classify loop (ms). */
  intervalMs: number;
  /** Confidence threshold — below this, escalate by default. */
  confidenceThreshold: number;
  /** Watchers to run. */
  watchers: WatcherConfig[];
  /** Escalation config. */
  escalation: {
    method: EscalationMethod;
    /** Shell command template for method: 'shell'. */
    command?: string;
    /** Target URL for method: 'http' or 'openclaw' (gateway base URL). */
    url?: string;
    /** Extra headers for method: 'http'. */
    headers?: Record<string, string>;
    /** Gateway auth token for method: 'openclaw'. */
    token?: string;
    /** Agent ID for method: 'openclaw' (default: 'main'). */
    agentId?: string;
    /** Number of recent journal entries to include as context. */
    contextWindow: number;
  };
  /** Journal config. */
  journal: {
    path: string;
  };
  /** User context injected into the classifier prompt. */
  userContext?: string;
}

// ─── Daemon ───────────────────────────────────────────────────────────────────

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  startedAt?: Date;
  eventsProcessed: number;
  eventsEscalated: number;
  eventsLogged: number;
  lastClassification?: Date;
  watcherCount: number;
}
