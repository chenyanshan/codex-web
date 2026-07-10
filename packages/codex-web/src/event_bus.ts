import type { CodexWebEvent } from './event_model.js';

export interface CodexWebStoredEvent {
  event: CodexWebEvent;
  sequence: number;
}

export type CodexWebEventListener = (storedEvent: CodexWebStoredEvent) => void;

export class CodexWebEventBus {
  private readonly maxEventsPerTurn: number;

  private readonly maxTurns: number;

  private readonly turns = new Map<string, CodexWebStoredEvent[]>();

  private readonly listeners = new Map<string, Set<CodexWebEventListener>>();

  private nextSequence = 1;

  constructor({
    maxEventsPerTurn = 500,
    maxTurns = 200,
  }: {
    maxEventsPerTurn?: number;
    maxTurns?: number;
  } = {}) {
    this.maxEventsPerTurn = maxEventsPerTurn;
    this.maxTurns = maxTurns;
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
      history.splice(0, history.length - this.maxEventsPerTurn);
    }
    this.turns.set(turnId, history);
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
    }
  }
}
