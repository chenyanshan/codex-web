import crypto from 'node:crypto';
import type { CodexWebEvent } from './event_model.js';

export interface CodexWebStoredEvent {
  event: CodexWebEvent;
  sequence: number;
}

export type CodexWebEventListener = (storedEvent: CodexWebStoredEvent) => void;

export type CodexWebReplayResetReason =
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

  private readonly turns = new Map<string, CodexWebStoredEvent[]>();

  private readonly listeners = new Map<string, Set<CodexWebEventListener>>();

  private readonly discardedThrough = new Map<string, number>();

  private readonly projections = new Map<string, Map<string, CodexWebProjectedEvent>>();

  private readonly projectionCompleteness = new Map<string, boolean>();

  private nextSequence = 1;

  constructor({
    maxEventsPerTurn = 500,
    maxTurns = 200,
    epoch = crypto.randomUUID(),
  }: {
    maxEventsPerTurn?: number;
    maxTurns?: number;
    epoch?: string;
  } = {}) {
    this.maxEventsPerTurn = maxEventsPerTurn;
    this.maxTurns = maxTurns;
    this.epoch = epoch.trim() || crypto.randomUUID();
  }

  append(turnId: string, event: CodexWebEvent): CodexWebStoredEvent {
    const storedEvent: CodexWebStoredEvent = {
      event,
      sequence: this.nextSequence++,
    };
    this.touchTurn(turnId);
    const history = this.turns.get(turnId) ?? [];
    history.push(storedEvent);
    if (history.length > this.maxEventsPerTurn) {
      const removed = history.splice(0, history.length - this.maxEventsPerTurn);
      const lastRemoved = removed.at(-1);
      if (lastRemoved) {
        this.discardedThrough.set(turnId, lastRemoved.sequence);
      }
    }
    this.turns.set(turnId, history);
    this.recordProjectionCompleteness(turnId, event);
    this.updateProjection(turnId, storedEvent);
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
        : [...history],
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
    while (this.turns.size > this.maxTurns) {
      const oldestTurnId = this.turns.keys().next().value as string | undefined;
      if (!oldestTurnId) {
        return;
      }
      if (this.listeners.has(oldestTurnId)) {
        this.touchTurn(oldestTurnId);
        if ([...this.turns.keys()].every((turnId) => this.listeners.has(turnId))) {
          return;
        }
        continue;
      }
      this.turns.delete(oldestTurnId);
      this.discardedThrough.delete(oldestTurnId);
      this.projections.delete(oldestTurnId);
      this.projectionCompleteness.delete(oldestTurnId);
    }
  }

  private updateProjection(turnId: string, storedEvent: CodexWebStoredEvent): void {
    const key = projectionKey(storedEvent.event);
    const projection = this.projections.get(turnId) ?? new Map<string, CodexWebProjectedEvent>();
    const existing = projection.get(key);
    projection.set(key, {
      firstSequence: existing?.firstSequence ?? storedEvent.sequence,
      storedEvent,
    });
    this.projections.set(turnId, projection);
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
