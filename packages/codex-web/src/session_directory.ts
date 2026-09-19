import type { ProviderThreadSummary, ProviderThreadListResult } from '@codex-mobile-web-app/codex-native-api';

/** Lightweight directory. A cold first view waits for one page; completion is shared. */
export class SessionDirectory {
  private stopped = false;
  private readonly activeScans = new Set<Map<string, ProviderThreadSummary>>();
  stop(): void { this.stopped = true; this.states.clear(); }

  private readonly metrics = { providerPages: 0, firstPageReads: 0, completeReads: 0, failures: 0 };
  diagnostics(): Readonly<typeof this.metrics> { return { ...this.metrics }; }

  private readonly states = new Map<boolean, {
    items: Map<string, ProviderThreadSummary>; complete: boolean; at: number;
    first: Promise<void>; refresh: Promise<void>; error?: unknown; invalidated?: boolean; snapshot?: ProviderThreadSummary[];
  }>();
  constructor(private readonly list: (args: { limit: number; cursor: string | null; archived: boolean }) => Promise<ProviderThreadListResult>) {}

  invalidate(): void { for (const state of this.states.values()) { state.at = 0; state.invalidated = true; } }

  updateName(threadId: string, title: string): void {
    for (const state of this.states.values()) {
      const thread = state.items.get(threadId);
      if (thread) state.items.set(threadId, { ...thread, title });
      state.snapshot = undefined;
    }
    for (const found of this.activeScans) {
      const thread = found.get(threadId);
      if (thread) found.set(threadId, { ...thread, title });
    }
  }

  async read(archived = false, complete = false): Promise<{ threads: ProviderThreadSummary[]; complete: boolean }> {
    if (this.stopped) throw new Error('Session directory stopped');
    if (complete) this.metrics.completeReads += 1; else this.metrics.firstPageReads += 1;
    let state = this.states.get(archived);
    if (!state || state.error || (state.complete && (state.invalidated || Date.now() - state.at > 30_000))) {
      const previous = state;
      let firstResolve!: () => void;
      let firstReject!: (error: unknown) => void;
      const first = new Promise<void>((resolve, reject) => { firstResolve = resolve; firstReject = reject; });
      state = { items: new Map(previous?.items), complete: false, at: Date.now(), first, refresh: Promise.resolve() };
      void first.catch(() => {});
      const current = state;
      this.states.set(archived, current);
      current.refresh = (async () => {
        const found = new Map<string, ProviderThreadSummary>();
        this.activeScans.add(found);
        try {
        const cursors = new Set<string>();
        let cursor: string | null = null;
        for (let pages = 0; pages < 10_000; pages += 1) {
          if (this.stopped) throw new Error('Session directory stopped');
          this.metrics.providerPages += 1;
          const page = await this.list({ limit: 100, cursor, archived });
          current.snapshot = undefined;
          for (const thread of page.items) {
            if (!thread.threadId) continue;
            const summary = { ...thread, turns: [] };
            found.set(thread.threadId, summary);
            current.items.set(thread.threadId, summary);
          }
          cursor = page.nextCursor ?? null;
          if (!cursor) {
            current.items = found;
            current.complete = true;
            current.at = Date.now();
            firstResolve();
            return;
          }
          if (cursors.has(cursor)) throw new Error('Codex thread/list repeated cursor');
          cursors.add(cursor);
          firstResolve();
          // Yield before starting the next provider request, including for synchronous stubs.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        throw new Error('Codex thread/list exceeded 10000 pages');
        } finally { this.activeScans.delete(found); }
      })().catch((error: unknown) => {
        this.metrics.failures += 1;
        current.error = error;
        firstReject(error);
        throw error;
      });
      // A background failure is retained and delivered to complete readers, never a false empty result.
      void current.refresh.catch(() => {});
    }
    if (complete) await state.refresh;
    else await state.first;
    if (state.error && complete) throw state.error;
    state.snapshot ??= [...state.items.values()];
    return { threads: state.snapshot, complete: state.complete };
  }
}
