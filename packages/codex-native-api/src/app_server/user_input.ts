import type { ToolRequestUserInputParams } from './generated/stable/v2/ToolRequestUserInputParams.js';
import type { ToolRequestUserInputResponse } from './generated/stable/v2/ToolRequestUserInputResponse.js';
export type UserInputResponse = ToolRequestUserInputResponse;
export interface UserInputRequest extends ToolRequestUserInputParams {
  requestId: string; connectionEpoch: number;
  status: 'pending' | 'delivery_unknown' | 'resolved' | 'expired';
}
interface Entry { request: UserInputRequest; rpcId: string | number; epoch: number; locked: boolean }
/** Official request schema is EXPERIMENTAL; no default answer, timeout answer, or replay. */
export class UserInputRequests {
  private entries = new Map<string, Entry>();
  constructor(private identity: string, private changed: (request: UserInputRequest, fresh: boolean) => void) {}
  receive(message: any, epoch: number): UserInputRequest {
    const p = message.params;
    if (!p || !['threadId', 'turnId', 'itemId'].every(k => typeof p[k] === 'string' && p[k].length > 0 && p[k].length < 1024)
      || typeof p.isBlocking !== 'boolean' || !Array.isArray(p.questions) || !p.questions.length || p.questions.length > 20
      || Buffer.byteLength(JSON.stringify(p)) > 32 * 1024) throw new Error('Invalid or oversized user input request');
    const ids = new Set<string>();
    for (const q of p.questions) {
      if (!q || typeof q.id !== 'string' || !q.id || ids.has(q.id) || typeof q.header !== 'string' || typeof q.question !== 'string'
        || typeof q.isOther !== 'boolean' || typeof q.isSecret !== 'boolean'
        || (q.options !== null && (!Array.isArray(q.options) || q.options.length > 30 || q.options.some((o: any) => typeof o?.label !== 'string' || typeof o?.description !== 'string')))) throw new Error('Invalid user input question');
      ids.add(q.id);
    }
    const requestId = `${this.identity}:${epoch}:${typeof message.id}:${message.id}`;
    const existing = this.entries.get(requestId);
    if (existing) return structuredClone(existing.request);
    while (this.entries.size >= 128) {
      const old = [...this.entries].find(([, e]) => ['resolved', 'expired'].includes(e.request.status));
      if (!old) throw new Error('User input capacity reached');
      this.entries.delete(old[0]);
    }
    const request: UserInputRequest = { threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, questions: structuredClone(p.questions),
      isBlocking: p.isBlocking, autoResolutionMs: Number.isFinite(p.autoResolutionMs) ? p.autoResolutionMs : null,
      requestId, connectionEpoch: epoch, status: 'pending' };
    this.entries.set(requestId, { request, rpcId: message.id, epoch, locked: false });
    this.changed(structuredClone(request), true);
    return structuredClone(request);
  }
  list(thread?: string): UserInputRequest[] { return [...this.entries.values()].filter(e => !thread || e.request.threadId === thread).map(e => structuredClone(e.request)); }
  resolve(params: any, epoch: number) {
    for (const e of this.entries.values()) if (e.epoch === epoch && e.rpcId === params?.requestId && e.request.threadId === params.threadId && e.request.status !== 'expired') {
      e.request.status = 'resolved'; this.changed(structuredClone(e.request), false);
    }
  }
  disconnect() {
    for (const e of this.entries.values()) if (e.request.status === 'pending') {
      e.request.status = e.locked ? 'delivery_unknown' : 'expired'; this.changed(structuredClone(e.request), false);
    }
  }
  async answer(id: string, response: UserInputResponse, epoch: () => number, connected: () => boolean,
    send: (payload: unknown) => void, beforeSend: () => Promise<void>): Promise<UserInputRequest> {
    const e = this.entries.get(id);
    if (!e || e.epoch !== epoch() || !connected() || e.request.status !== 'pending' || e.locked) throw new Error('User input request is no longer answerable');
    if (!response?.answers || typeof response.answers !== 'object' || Array.isArray(response.answers) || Buffer.byteLength(JSON.stringify(response)) > 32 * 1024) throw new Error('Invalid user input answers');
    const ids = new Set(e.request.questions.map(q => q.id));
    if (Object.keys(response.answers).length !== ids.size || Object.keys(response.answers).some(k => !ids.has(k))) throw new Error('Answers must match the question IDs');
    for (const id of ids) {
      const answer = response.answers[id];
      if (!answer || !Array.isArray(answer.answers) || answer.answers.length === 0 || answer.answers.length > 30 || answer.answers.some(a => typeof a !== 'string')) throw new Error('Invalid answer');
    }
    const frozen = structuredClone(response);
    e.locked = true;
    try { await beforeSend(); } catch (error) { e.locked = false; throw error; }
    if (e.epoch !== epoch() || !connected() || e.request.status !== 'pending') {
      if ((e.request.status as UserInputRequest['status']) !== 'resolved') e.request.status = 'expired';
      this.changed(structuredClone(e.request), false);
      return structuredClone(e.request);
    }
    // JSON-RPC responses have no ACK. A successful socket write is still unknown delivery.
    e.request.status = 'delivery_unknown';
    this.changed(structuredClone(e.request), false);
    try { send({ jsonrpc: '2.0', id: e.rpcId, result: frozen }); } catch { /* never replay after a send attempt */ }
    return structuredClone(e.request);
  }
}
