/** Bounded presentation of official v2 notifications, not an execution state machine.
 * Protocol source: generated/stable (manifest.json). Notification routing reference:
 * OpenAI Codex 68e1a421, tui/src/chatwidget/protocol.rs. Independently implemented.
 */
import type { ThreadTokenUsage } from './generated/stable/v2/ThreadTokenUsage.js';
export interface TurnActivitySnapshot {
  threadId: string; turnId: string; revision: number; observedAt: number; lastProgressAt: number | null;
  health: { status: 'working' | 'retrying' | 'completed' | 'failed' | 'interrupted'; observedRetryCount: number; lastError: string | null };
  observation: 'connected' | 'disconnected';
  compaction: 'idle' | 'running' | 'completed';
  plan: { explanation: string | null; steps: Array<{ step: string; status: string }> } | null;
  tools: Array<{ itemId: string; kind: string; title: string; status: string; observedAt: number }>;
  agents: Array<{ threadId: string; status: string; message: string | null; prompt?: string | null; observedAt: number }>;
  tokenUsage: ThreadTokenUsage | null;
  diff: { available: boolean; bytes: number; truncated: boolean };
  truncated: boolean;
}
const MAX_FIELD = 2048;
export function boundedActivityText(value: unknown, bytes = MAX_FIELD): string {
  const clean = String(value ?? '').replace(/(Bearer\s+)[\w.\-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
  if (Buffer.byteLength(clean) <= bytes) return clean;
  return Buffer.from(clean).subarray(0, bytes - 16).toString('utf8').replace(/\uFFFD$/u, '') + '…[truncated]';
}
export class TurnActivityProjection {
  private snapshots = new Map<string, TurnActivitySnapshot>();
  private diffs = new Map<string, { text: string; bytes: number; truncated: boolean }>();
  private key(thread: string, turn: string) { return JSON.stringify([thread, turn]); }
  get(thread: string, turn?: string): TurnActivitySnapshot | null {
    const snapshot = turn ? this.snapshots.get(this.key(thread, turn)) : [...this.snapshots.values()].reverse().find(s => s.threadId === thread);
    return snapshot ? structuredClone(snapshot) : null;
  }
  getDiff(thread: string, turn: string) { return this.diffs.get(this.key(thread, turn)) ?? null; }
  list(): TurnActivitySnapshot[] { return [...this.snapshots.values()].map(s => structuredClone(s)); }
  revisions(): Map<string, number> { return new Map([...this.snapshots].map(([k, s]) => [k, s.revision])); }
  hydrate(thread: any, baseline: Map<string, number>, now = Date.now()): TurnActivitySnapshot | null {
    const turn = thread?.turns?.at(-1);
    if (typeof thread?.id !== 'string' || typeof turn?.id !== 'string') return null;
    const key = this.key(thread.id, turn.id), previous = this.snapshots.get(key);
    // A notification delivered while thread/read was in flight is more recent evidence.
    if ((previous?.revision ?? 0) !== (baseline.get(key) ?? 0)) return null;
    const temporary = new TurnActivityProjection();
    const params = { threadId: thread.id, turnId: turn.id };
    temporary.observe({ method: 'turn/started', params }, now);
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of items.slice(-128)) temporary.observe({ method: item.status === 'inProgress' ? 'item/started' : 'item/completed', params: { ...params, item } }, now);
    if (['completed', 'failed', 'interrupted'].includes(turn.status)) temporary.observe({ method: 'turn/completed', params: { ...params, turn } }, now);
    const next = temporary.get(thread.id, turn.id)!;
    // Read success proves observation, not new model/tool progress. Retry history cannot be reconstructed.
    next.lastProgressAt = previous?.lastProgressAt ?? null;
    if (previous) {
      next.health.observedRetryCount = previous.health.observedRetryCount;
      next.health.lastError ??= previous.health.lastError;
      if (!['completed', 'failed', 'interrupted'].includes(next.health.status)) next.health.status = previous.health.status;
      next.plan = previous.plan; next.tokenUsage = previous.tokenUsage; next.diff = previous.diff;
      for (const item of next.tools) item.observedAt = previous.tools.find(t => t.itemId === item.itemId)?.observedAt ?? now;
      for (const agent of next.agents) {
        const prior = previous.agents.find(a => a.threadId === agent.threadId);
        agent.observedAt = prior?.observedAt ?? now;
        agent.prompt ??= prior?.prompt ?? null;
      }
      next.revision = previous.revision; next.observedAt = previous.observedAt;
      if (JSON.stringify(next) === JSON.stringify(previous)) return null;
    }
    boundSnapshot(next);
    next.revision = (previous?.revision ?? 0) + 1; next.observedAt = now;
    this.snapshots.set(key, next);
    while (this.snapshots.size > 128) { const oldest = this.snapshots.keys().next().value!; this.snapshots.delete(oldest); this.diffs.delete(oldest); }
    return structuredClone(next);
  }
  disconnect(): TurnActivitySnapshot[] {
    const changed: TurnActivitySnapshot[] = [];
    for (const s of this.snapshots.values()) if (s.observation !== 'disconnected') {
      s.observation = 'disconnected'; s.revision++; changed.push(structuredClone(s));
    }
    return changed;
  }
  observe(message: { method?: string; params?: any }, now = Date.now()): TurnActivitySnapshot | null {
    const { method, params: p = {} } = message;
    const thread = p.threadId, turn = p.turnId ?? p.turn?.id;
    if (typeof thread !== 'string' || typeof turn !== 'string') return null;
    const relevant = method === 'error' || method === 'turn/started' || method === 'turn/completed' || method === 'turn/plan/updated'
      || method === 'thread/compacted' || method === 'turn/diff/updated' || method === 'thread/tokenUsage/updated' || method === 'item/started' || method === 'item/completed'
      || ['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/commandExecution/outputDelta', 'item/mcpToolCall/progress'].includes(method ?? '');
    if (!relevant) return null;
    const key = this.key(thread, turn);
    let s = this.snapshots.get(key);
    if (!s) {
      s = { threadId: thread, turnId: turn, revision: 0, observedAt: now, lastProgressAt: null,
        health: { status: 'working', observedRetryCount: 0, lastError: null }, observation: 'connected', compaction: 'idle',
        plan: null, tools: [], agents: [], tokenUsage: null, diff: { available: false, bytes: 0, truncated: false }, truncated: false };
      this.snapshots.set(key, s);
      while (this.snapshots.size > 128) { const oldest = this.snapshots.keys().next().value!; this.snapshots.delete(oldest); this.diffs.delete(oldest); }
    }
    const before = JSON.stringify(s);
    const terminal = ['completed', 'failed', 'interrupted'].includes(s.health.status);
    if (terminal && method !== 'turn/diff/updated' && method !== 'thread/tokenUsage/updated') return null;
    const progressOnly = ['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/commandExecution/outputDelta', 'item/mcpToolCall/progress'].includes(method ?? '');
    // Keep progress evidence fresh internally, but stream at most once per five seconds.
    // Retry recovery and observation reconnection are state changes and publish immediately.
    if (progressOnly && s.revision > 0 && s.health.status === 'working' && s.observation === 'connected' && now - s.observedAt < 5_000) {
      s.lastProgressAt = now; s.revision++;
      return null;
    }
    s.observation = 'connected';
    if (method === 'error') {
      if (p.willRetry === true) { s.health.status = 'retrying'; s.health.observedRetryCount++; }
      s.health.lastError = boundedActivityText([p.error?.message ?? 'Unknown upstream error', p.error?.additionalDetails].filter(Boolean).join('\n'));
    } else if (method === 'turn/completed') {
      s.health.status = ['failed', 'interrupted'].includes(p.turn?.status) ? p.turn.status : 'completed';
      if (p.turn?.error?.message) s.health.lastError = boundedActivityText(p.turn.error.message);
      if (s.compaction === 'running') s.compaction = 'idle';
    } else if (method === 'thread/compacted') {
      s.compaction = 'completed'; s.lastProgressAt = now; s.health.status = 'working';
    } else if (method === 'turn/plan/updated') {
      const steps = Array.isArray(p.plan) ? p.plan : [];
      s.plan = { explanation: p.explanation == null ? null : boundedActivityText(p.explanation, 1024),
        steps: steps.slice(0, 20).map((x: any) => ({ step: boundedActivityText(x.step, 512), status: boundedActivityText(x.status, 64) })) };
      s.truncated ||= steps.length > 20;
    } else if (method === 'thread/tokenUsage/updated') {
      if (p.tokenUsage && typeof p.tokenUsage === 'object') {
        const usage = (v: any) => Object.fromEntries(['totalTokens', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens'].map(k => [k, Number.isFinite(v?.[k]) ? Math.max(0, v[k]) : 0]));
        s.tokenUsage = { total: usage(p.tokenUsage.total), last: usage(p.tokenUsage.last), modelContextWindow: Number.isFinite(p.tokenUsage.modelContextWindow) ? p.tokenUsage.modelContextWindow : null } as ThreadTokenUsage;
      }
    } else if (method === 'turn/diff/updated' && typeof p.diff === 'string') {
      const bytes = Buffer.byteLength(p.diff), truncated = bytes > 128 * 1024;
      // Content is available only through the authorized, on-demand detail route.
      this.diffs.set(key, { text: truncated ? Buffer.from(p.diff).subarray(0, 128 * 1024).toString('utf8') : p.diff, bytes, truncated });
      s.diff = { available: true, bytes, truncated };
    } else {
      const item = p.item;
      const collab = item?.type === 'collabAgentToolCall' || item?.type === 'subAgentActivity';
      if (!collab) { s.lastProgressAt = now; s.health.status = 'working'; }
      if (item?.type === 'contextCompaction') s.compaction = method === 'item/completed' ? 'completed' : 'running';
      else if (item && !['agentMessage', 'userMessage', 'reasoning'].includes(item.type)) {
        const next = { itemId: boundedActivityText(item.id, 256), kind: boundedActivityText(item.type, 64), title: boundedActivityText(item.tool ?? item.command ?? item.query ?? item.type, 512), status: boundedActivityText(item.status ?? (method === 'item/completed' ? 'completed' : 'running'), 64), observedAt: now };
        s.tools = [...s.tools.filter(x => x.itemId !== next.itemId), next].slice(-20);
        const updateAgent = (id: string, status: unknown, message: unknown, prompt?: unknown) => {
          const threadId = boundedActivityText(id, 256);
          const previous = s!.agents.find(agent => agent.threadId === threadId);
          const agent = { threadId, status: boundedActivityText(status ?? previous?.status ?? 'unknown', 64),
            message: message == null ? previous?.message ?? null : boundedActivityText(message, 256),
            prompt: typeof prompt === 'string' && prompt.trim() ? boundedActivityText(prompt, 2048) : previous?.prompt ?? null, observedAt: now };
          s!.agents = previous ? s!.agents.map(entry => entry.threadId === threadId ? agent : entry) : [...s!.agents, agent].slice(-20);
        };
        if (item.type === 'subAgentActivity' && typeof item.agentThreadId === 'string') {
          updateAgent(item.agentThreadId, item.kind, null);
        }
        const states = item.agentsStates ?? item.agents_states;
        const receivers: string[] = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((id: unknown) => typeof id === 'string').slice(0, 20) : [];
        const ids = [...new Set([...receivers, ...Object.keys(states ?? {}).slice(0, 20)])].slice(0, 20);
        for (const id of ids) {
          const state = states?.[id];
          updateAgent(id, state?.status, state?.message, receivers.includes(id) ? item.prompt : null);
        }
      }
    }
    boundSnapshot(s);
    if (JSON.stringify(s) === before) return null;
    s.revision++; s.observedAt = now;
    return structuredClone(s);
  }
}

function boundSnapshot(s: TurnActivitySnapshot): void {
  while (Buffer.byteLength(JSON.stringify(s)) > 32 * 1024) {
    s.truncated = true;
    if (s.tools.length) s.tools.shift();
    else if (s.agents.length) s.agents.shift();
    else if (s.plan?.steps.length) s.plan.steps.shift();
    else break;
  }
}
