import type { UserInputRequest, UserInputResponse } from '@codex-mobile-web-app/codex-native-api';
import { FileUserInputStore, type UserInputReceipt } from './user_input_store.js';
interface UserInputRuntime {
  listUserInputRequests(threadId: string): UserInputRequest[];
  answerUserInput(threadId: string, requestId: string, response: UserInputResponse, beforeSend: () => Promise<void>): Promise<UserInputRequest>;
}
/** Caller must authenticate and authorize session ownership/write access before invoking.
 * Public capability-share routes must never call this handler. `path` is the session suffix.
 */
export async function handleUserInputRoute({ method, path, body, ownerUserId, sessionId, threadId, runtime, store }: {
  method: string; path: string; body?: unknown; ownerUserId: string; sessionId: string; threadId: string;
  runtime: UserInputRuntime; store: FileUserInputStore;
}): Promise<{ status: number; body: unknown } | null> {
  if (!path.startsWith('/user-input')) return null;
  const requests = () => runtime.listUserInputRequests(threadId).filter(q => q.threadId === threadId);
  if (method === 'GET' && path === '/user-input') return { status: 200, body: { requests: requests() } };
  const receiptMatch = /^\/user-input\/receipts\/([^/]+)$/.exec(path);
  if (method === 'GET' && receiptMatch) {
    const submissionId = decodeURIComponent(receiptMatch[1]!);
    let receipt = await store.read(ownerUserId, sessionId, submissionId);
    if (!receipt) return { status: 404, body: { error: 'Answer receipt not found', code: 'answer_receipt_missing', outcomeUnknown: true } };
    const request = requests().find(q => q.requestId === receipt!.requestId);
    if (request?.status === 'resolved' || request?.status === 'expired') receipt = await store.update(ownerUserId, sessionId, submissionId, request.status);
    return { status: 200, body: { receipt: publicReceipt(receipt), request: request ?? null } };
  }
  const answerMatch = /^\/user-input\/([^/]+)\/answer$/.exec(path);
  if (method !== 'POST' || !answerMatch) return { status: 404, body: { error: 'Unknown question endpoint' } };
  const input = body as { answerSubmissionId?: unknown; answers?: unknown } | undefined;
  if (!input || typeof input.answerSubmissionId !== 'string' || !input.answerSubmissionId || input.answerSubmissionId.length > 256) return { status: 400, body: { error: 'answerSubmissionId is required' } };
  const requestId = decodeURIComponent(answerMatch[1]!);
  const prepare = () => store.prepare({ ownerUserId, sessionId, requestId, answerSubmissionId: input.answerSubmissionId as string, answers: input.answers });
  const existing = await store.read(ownerUserId, sessionId, input.answerSubmissionId);
  if (existing) {
    // Also validate payload identity. An existing receipt never authorizes a second send.
    try { await prepare(); } catch { return { status: 409, body: { error: 'Answer submission identity conflict', code: 'answer_conflict' } }; }
    return { status: 200, body: { receipt: publicReceipt(existing), request: requests().find(q => q.requestId === requestId) ?? null } };
  }
  const request = requests().find(q => q.requestId === requestId);
  if (!request || request.status !== 'pending') return { status: 409, body: { error: 'Question is unavailable or expired', code: 'question_expired' } };
  let persisted: UserInputReceipt | null = null;
  try {
    const result = await runtime.answerUserInput(threadId, requestId, { answers: input.answers } as UserInputResponse, async () => {
      const prepared = await prepare(); persisted = prepared.record;
      if (!prepared.created) throw new Error('Answer already submitted');
    });
    if (!persisted) throw new Error('Answer receipt was not persisted');
    const status = result.status === 'resolved' || result.status === 'expired' ? result.status : 'delivery_unknown';
    const receipt = await store.update(ownerUserId, sessionId, input.answerSubmissionId, status);
    return { status: 200, body: { receipt: publicReceipt(receipt), request: result } };
  } catch (error) {
    const receipt = await store.read(ownerUserId, sessionId, input.answerSubmissionId);
    if (receipt) return { status: 200, body: { receipt: publicReceipt(receipt), request: requests().find(q => q.requestId === requestId) ?? null } };
    return { status: 409, body: { error: error instanceof Error ? error.message : 'Answer could not be submitted', code: 'answer_not_submitted' } };
  }
}
function publicReceipt(receipt: UserInputReceipt) {
  return { answerSubmissionId: receipt.answerSubmissionId, requestId: receipt.requestId, status: receipt.status, updatedAt: receipt.updatedAt };
}
