import crypto from 'node:crypto';
import type { CodexWebEvent } from './event_model.js';
import {
  DEFAULT_MAX_EVENT_BYTES,
  DEFAULT_MAX_TOTAL_EVENT_BYTES,
  DEFAULT_MAX_TURN_BYTES,
  fitEventForRetention,
  mergeProjectedAssistantUpdate,
  mergeProjectedBatchUpdate,
  retainedEventSize,
} from './event_memory.js';

export interface CodexWebStoredEvent {
  event: CodexWebEvent;
  sequence: number;
}

export type CodexWebEventListener = (storedEvent: CodexWebStoredEvent) => void;

export type CodexWebReplayResetReason =
  | 'initial_snapshot'
  | 'epoch_mismatch'
  | 'cursor_expired'
  | 'cursor_ahead'
  | 'history_truncated';

export interface CodexWebEventReplay {
  epoch: string;
  reset: boolean;
  resetReason: CodexWebReplayResetReason | null;
  retainedFrom: number | null;
  retainedFloor: number;
  latestSequence: number | null;
  snapshotComplete: boolean;
  events: CodexWebStoredEvent[];
}

interface CodexWebProjectedEvent {
  firstSequence: number;
  storedEvent: CodexWebStoredEvent;
}

export class CodexWebEventBus {
  readonly epoch: string;

  private readonly maxEventsPerTurn: number;

  private readonly maxTurns: number;

  private readonly maxEventBytes: number;

  private readonly maxBytesPerTurn: number;

  private readonly maxTotalBytes: number;

  private readonly turns = new Map<string, CodexWebStoredEvent[]>();

  private readonly listeners = new Map<string, Set<CodexWebEventListener>>();

  private readonly discardedThrough = new Map<string, number>();

  private readonly projections = new Map<string, Map<string, CodexWebProjectedEvent>>();

  private readonly projectionCompleteness = new Map<string, boolean>();

  private readonly historyBytes = new Map<string, number>();

  private readonly projectionBytes = new Map<string, number>();

  private readonly eventSizes = new WeakMap<CodexWebStoredEvent, number>();

  private totalRetainedBytes = 0;

  private nextSequence = 1;

  constructor({
    maxEventsPerTurn = 500,
    maxTurns = 200,
    maxEventBytes = DEFAULT_MAX_EVENT_BYTES,
    maxBytesPerTurn = DEFAULT_MAX_TURN_BYTES,
    maxTotalBytes = DEFAULT_MAX_TOTAL_EVENT_BYTES,
    epoch = crypto.randomUUID(),
  }: {
    maxEventsPerTurn?: number;
    maxTurns?: number;
    maxEventBytes?: number;
    maxBytesPerTurn?: number;
    maxTotalBytes?: number;
    epoch?: string;
  } = {}) {
    this.maxEventsPerTurn = Math.max(1, maxEventsPerTurn);
    this.maxTurns = Math.max(1, maxTurns);
    this.maxEventBytes = Math.max(1024, maxEventBytes);
    this.maxBytesPerTurn = Math.max(this.maxEventBytes, maxBytesPerTurn);
    this.maxTotalBytes = Math.max(this.maxBytesPerTurn, maxTotalBytes);
    this.epoch = epoch.trim() || crypto.randomUUID();
  }

  append(turnId: string, event: CodexWebEvent): CodexWebStoredEvent {
    const storedEvent: CodexWebStoredEvent = {
      event: fitEventForRetention(event, this.maxEventBytes),
      sequence: this.nextSequence++,
    };
    const storedBytes = retainedEventSize(storedEvent.event);
    this.eventSizes.set(storedEvent, storedBytes);
    this.touchTurn(turnId);
    const history = this.turns.get(turnId) ?? [];
    history.push(storedEvent);
    this.adjustHistoryBytes(turnId, storedBytes);
    if (history.length > this.maxEventsPerTurn) {
      this.discardHistory(turnId, history, history.length - this.maxEventsPerTurn);
    }
    this.turns.set(turnId, history);
    this.recordProjectionCompleteness(turnId, storedEvent.event);
    this.updateProjection(turnId, storedEvent);
    this.trimTurnBytes(turnId);
    this.trimTurns();
    const turnListeners = this.listeners.get(turnId);
    if (turnListeners) {
      for (const listener of turnListeners) {
        listener(storedEvent);
      }
    }
    return storedEvent;
  }

  list(turnId: string, afterId?: string | number | null): CodexWebStoredEvent[] {
    const history = this.turns.get(turnId) ?? [];
    if (afterId === undefined || afterId === null || afterId === '') {
      return [...history];
    }
    const normalizedAfter = typeof afterId === 'number' ? afterId : Number(afterId);
    if (!Number.isFinite(normalizedAfter)) {
      return [...history];
    }
    return history.filter((entry) => entry.sequence > normalizedAfter);
  }

  replay(
    turnId: string,
    afterId?: string | number | null,
    requestedEpoch?: string | null,
  ): CodexWebEventReplay {
    const history = this.turns.get(turnId) ?? [];
    const retainedFloor = this.discardedThrough.get(turnId) ?? 0;
    const retainedFrom = history[0]?.sequence ?? null;
    const latestSequence = history.at(-1)?.sequence ?? null;
    const normalizedAfter = normalizeSequence(afterId);
    let resetReason: CodexWebReplayResetReason | null = null;
    if (requestedEpoch && requestedEpoch !== this.epoch) {
      resetReason = 'epoch_mismatch';
    } else if (normalizedAfter !== null && normalizedAfter < retainedFloor) {
      resetReason = 'cursor_expired';
    } else if (
      normalizedAfter !== null
      && (latestSequence === null || normalizedAfter > latestSequence)
    ) {
      resetReason = 'cursor_ahead';
    } else if (normalizedAfter === null && retainedFloor > 0) {
      resetReason = 'history_truncated';
    } else if (normalizedAfter === null && history.length > 0) {
      resetReason = 'initial_snapshot';
    }
    return {
      epoch: this.epoch,
      reset: resetReason !== null,
      resetReason,
      retainedFrom,
      retainedFloor,
      latestSequence,
      snapshotComplete: resetReason !== 'epoch_mismatch'
        && this.projectionCompleteness.get(turnId) === true,
      events: resetReason === null && normalizedAfter !== null
        ? history.filter((entry) => entry.sequence > normalizedAfter)
        : [],
    };
  }

  snapshot(turnId: string): CodexWebStoredEvent[] {
    const projection = this.projections.get(turnId);
    if (!projection) {
      return [];
    }
    return [...projection.values()]
      .sort((left, right) => left.firstSequence - right.firstSequence)
      .map((entry) => entry.storedEvent);
  }

  retentionStats(): {
    totalBytes: number;
    turnBytes: number;
    turns: number;
    listeners: number;
  } {
    return {
      totalBytes: this.totalRetainedBytes,
      turnBytes: [...new Set([...this.historyBytes.keys(), ...this.projectionBytes.keys()])]
        .reduce((total, turnId) => total + this.retainedBytesForTurn(turnId), 0),
      turns: this.turns.size,
      listeners: [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0),
    };
  }

  subscribe(turnId: string, listener: CodexWebEventListener): () => void {
    this.touchTurn(turnId);
    const turnListeners = this.listeners.get(turnId) ?? new Set<CodexWebEventListener>();
    turnListeners.add(listener);
    this.listeners.set(turnId, turnListeners);
    return () => {
      const listeners = this.listeners.get(turnId);
      if (!listeners) {
        return;
      }
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(turnId);
      }
    };
  }

  private touchTurn(turnId: string): void {
    const history = this.turns.get(turnId);
    if (!history) {
      return;
    }
    this.turns.delete(turnId);
    this.turns.set(turnId, history);
  }

  private trimTurns(): void {
    while (this.turns.size > this.maxTurns || this.totalRetainedBytes > this.maxTotalBytes) {
      const oldestTurnId = this.turns.keys().next().value as string | undefined;
      if (!oldestTurnId) {
        return;
      }
      this.evictTurn(oldestTurnId);
    }
    this.trimDiscardedMetadata();
  }

  private updateProjection(turnId: string, storedEvent: CodexWebStoredEvent): void {
    const key = projectionKey(storedEvent.event);
    const projection = this.projections.get(turnId) ?? new Map<string, CodexWebProjectedEvent>();
    const existing = projection.get(key);
    const projectedEvent = storedEvent.event.type === 'batch.updated'
      ? mergeProjectedBatchUpdate(
          existing?.storedEvent.event.type === 'batch.updated' ? existing.storedEvent.event : null,
          storedEvent.event,
        )
      : storedEvent.event.type === 'assistant.delta'
        ? mergeProjectedAssistantUpdate(existing?.storedEvent.event ?? null, storedEvent.event)
      : storedEvent.event;
    const projectedStoredEvent = projectedEvent === storedEvent.event
      ? storedEvent
      : { event: projectedEvent, sequence: storedEvent.sequence };
    if (projectedStoredEvent !== storedEvent) {
      this.eventSizes.set(projectedStoredEvent, retainedEventSize(projectedEvent));
    }
    if (existing) {
      this.adjustProjectionBytes(turnId, -this.sizeOf(existing.storedEvent));
      projection.delete(key);
    }
    projection.set(key, {
      firstSequence: existing?.firstSequence ?? storedEvent.sequence,
      storedEvent: projectedStoredEvent,
    });
    this.adjustProjectionBytes(turnId, this.sizeOf(projectedStoredEvent));
    this.projections.set(turnId, projection);
  }

  private trimTurnBytes(turnId: string): void {
    const history = this.turns.get(turnId) ?? [];
    while (history.length > 0 && this.retainedBytesForTurn(turnId) > this.maxBytesPerTurn) {
      this.discardHistory(turnId, history, 1);
    }
    const projection = this.projections.get(turnId);
    while (projection && projection.size > 0 && this.retainedBytesForTurn(turnId) > this.maxBytesPerTurn) {
      const oldestKey = projection.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const removed = projection.get(oldestKey);
      projection.delete(oldestKey);
      if (removed) {
        this.adjustProjectionBytes(turnId, -this.sizeOf(removed.storedEvent));
      }
      this.projectionCompleteness.set(turnId, false);
    }
  }

  private discardHistory(turnId: string, history: CodexWebStoredEvent[], count: number): void {
    const removed = history.splice(0, count);
    for (const entry of removed) {
      this.adjustHistoryBytes(turnId, -this.sizeOf(entry));
    }
    const lastRemoved = removed.at(-1);
    if (lastRemoved) {
      this.rememberDiscardedThrough(turnId, lastRemoved.sequence);
    }
  }

  private evictTurn(turnId: string): void {
    const history = this.turns.get(turnId) ?? [];
    const latestSequence = Math.max(
      history.at(-1)?.sequence ?? 0,
      ...[...(this.projections.get(turnId)?.values() ?? [])]
        .map((entry) => entry.storedEvent.sequence),
    );
    this.totalRetainedBytes -= this.historyBytes.get(turnId) ?? 0;
    this.totalRetainedBytes -= this.projectionBytes.get(turnId) ?? 0;
    this.historyBytes.delete(turnId);
    this.projectionBytes.delete(turnId);
    this.turns.delete(turnId);
    this.projections.delete(turnId);
    this.projectionCompleteness.delete(turnId);
    if (latestSequence) {
      this.rememberDiscardedThrough(turnId, latestSequence);
    }
  }

  private retainedBytesForTurn(turnId: string): number {
    return (this.historyBytes.get(turnId) ?? 0) + (this.projectionBytes.get(turnId) ?? 0);
  }

  private adjustHistoryBytes(turnId: string, delta: number): void {
    const next = Math.max(0, (this.historyBytes.get(turnId) ?? 0) + delta);
    this.historyBytes.set(turnId, next);
    this.totalRetainedBytes = Math.max(0, this.totalRetainedBytes + delta);
  }

  private adjustProjectionBytes(turnId: string, delta: number): void {
    const next = Math.max(0, (this.projectionBytes.get(turnId) ?? 0) + delta);
    this.projectionBytes.set(turnId, next);
    this.totalRetainedBytes = Math.max(0, this.totalRetainedBytes + delta);
  }

  private sizeOf(event: CodexWebStoredEvent): number {
    return this.eventSizes.get(event) ?? retainedEventSize(event.event);
  }

  private rememberDiscardedThrough(turnId: string, sequence: number): void {
    const previous = this.discardedThrough.get(turnId) ?? 0;
    this.discardedThrough.delete(turnId);
    this.discardedThrough.set(turnId, Math.max(previous, sequence));
  }

  private trimDiscardedMetadata(): void {
    while (this.discardedThrough.size > this.maxTurns * 2) {
      const oldestTurnId = this.discardedThrough.keys().next().value as string | undefined;
      if (!oldestTurnId) {
        break;
      }
      this.discardedThrough.delete(oldestTurnId);
    }
  }

  private recordProjectionCompleteness(turnId: string, event: CodexWebEvent): void {
    if (this.projectionCompleteness.has(turnId)) {
      return;
    }
    this.projectionCompleteness.set(
      turnId,
      event.type === 'turn.started' && !isRecoveredTurnStart(event),
    );
  }
}

function isRecoveredTurnStart(event: Extract<CodexWebEvent, { type: 'turn.started' }>): boolean {
  if (!event.raw || typeof event.raw !== 'object' || Array.isArray(event.raw)) {
    return false;
  }
  return (event.raw as Record<string, unknown>).recovered === true;
}

function normalizeSequence(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const sequence = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(sequence) ? sequence : null;
}

function projectionKey(event: CodexWebEvent): string {
  switch (event.type) {
    case 'turn.started':
      return 'turn:started';
    case 'assistant.delta':
    case 'assistant.final':
      return `assistant:${event.itemId || (event.type === 'assistant.delta' ? event.phase : 'final_answer') || 'message'}`;
    case 'batch.started':
      return `batch:${event.batchId}:started`;
    case 'batch.updated':
      return `batch:${event.batchId}:updated`;
    case 'batch.completed':
      return `batch:${event.batchId}:completed`;
    case 'approval.requested':
      return `approval:${event.approvalId}:requested`;
    case 'approval.resolved':
      return `approval:${event.approvalId}:resolved`;
    case 'turn.completed':
    case 'turn.failed':
      return 'turn:terminal';
  }
}
