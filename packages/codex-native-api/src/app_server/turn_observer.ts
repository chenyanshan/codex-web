import type { TurnCompletedNotification } from './generated/stable/v2/TurnCompletedNotification.js';

/** Identity-scoped official projection. No text-based deduplication or inferred terminal state. */
export class TurnObserver {
  terminal: TurnCompletedNotification['turn'] | null = null;
  private readonly items = new Map<string, Record<string, unknown>>();
  private bytes = 0;
  constructor(readonly threadId: string, readonly turnId: string) {}
  accept(message: any): boolean {
    const params = message?.params;
    if (params?.threadId !== this.threadId) return false;
    if (message.method === 'turn/completed') {
      const turn = params.turn;
      if (!turn || turn.id !== this.turnId || !['completed', 'failed', 'interrupted'].includes(turn.status)) return false;
      if (!this.terminal) this.terminal = { ...turn, items: Array.isArray(turn.items) && turn.items.length ? turn.items : [...this.items.values()] };
      return true;
    }
    if (this.terminal || params.turnId !== this.turnId) return false;
    const item = params.item;
    if ((message.method === 'item/started' || message.method === 'item/completed') && typeof item?.id === 'string' && typeof item.type === 'string') {
      const previous = this.items.get(item.id);
      const bytes = Buffer.byteLength(JSON.stringify(item));
      const previousBytes = previous ? Buffer.byteLength(JSON.stringify(previous)) : 0;
      if ((previous || this.items.size < 512) && this.bytes - previousBytes + bytes <= 2 * 1024 * 1024) {
        this.items.set(item.id, item);
        this.bytes += bytes - previousBytes;
      }
    }
    return false;
  }
}
