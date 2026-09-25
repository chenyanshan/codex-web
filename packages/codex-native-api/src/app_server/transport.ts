/** One request/response correlation table for the existing CodexAppClient facade.
 * There is deliberately no retry: after send, delivery is uncertain until a response.
 */
export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}
export interface TransportHost {
  socket: WebSocket | null;
  connected: boolean;
  requestId: number;
  pending: Map<string, PendingRequest>;
  start(): Promise<void>;
  send(payload: unknown): void;
}
export class AppServerResponseUncertainError extends Error {
  readonly code = 'app_server_response_uncertain';
  constructor(readonly method: string, message: string) { super(message); }
}
export class AppServerObservationInterruptedError extends Error {
  readonly code = 'app_server_observation_interrupted';
}
export async function request(host: TransportHost, method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
  if (!host.socket || !host.connected) await host.start();
  if (host.pending.size >= 1024) throw new Error('Codex app-server pending request limit reached');
  const id = String(++host.requestId);
  return new Promise((resolve, reject) => {
    let sent = false;
    const timer = setTimeout(() => {
      host.pending.delete(id);
      reject(new AppServerResponseUncertainError(method, `Timed out waiting for Codex JSON-RPC response to ${method}`));
    }, Math.max(1, timeoutMs));
    host.pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => {
        clearTimeout(timer);
        reject(sent && error instanceof AppServerObservationInterruptedError
          ? new AppServerResponseUncertainError(method, error.message) : error);
      },
    });
    try {
      sent = true;
      host.send({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      host.pending.delete(id);
      clearTimeout(timer);
      reject(new AppServerResponseUncertainError(method, String(error instanceof Error ? error.message : error)));
    }
  });
}
export function parseMessage(raw: string): Record<string, any> | null {
  let message: any;
  try { message = JSON.parse(raw); } catch { return null; }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if ('id' in message && typeof message.id !== 'string' && typeof message.id !== 'number') return null;
  if ('method' in message && typeof message.method !== 'string') return null;
  if ('method' in message && message.params != null && (typeof message.params !== 'object' || Array.isArray(message.params))) return null;
  return message;
}
export function acceptResponse(host: TransportHost, message: Record<string, any>): boolean {
  if (!('id' in message) || 'method' in message) return false;
  const pending = host.pending.get(String(message.id));
  if (!pending) return true;
  host.pending.delete(String(message.id));
  if (message.error) {
    const error = new Error(typeof message.error.message === 'string' ? message.error.message : 'JSON-RPC error') as Error & { rpcCode?: unknown; data?: unknown; code?: string };
    error.rpcCode = message.error.code;
    error.data = message.error.data;
    const info = message.error.data?.codexErrorInfo ?? message.error.data?.codex_error_info;
    if (info?.activeTurnNotSteerable || info?.active_turn_not_steerable) error.code = 'active_turn_not_steerable';
    pending.reject(error);
  } else if ('result' in message) pending.resolve(message.result);
  else pending.reject(new AppServerResponseUncertainError('unknown', 'Malformed Codex JSON-RPC response'));
  return true;
}
export function rejectPending(host: TransportHost, error: Error): void {
  for (const pending of host.pending.values()) pending.reject(error);
  host.pending.clear();
}
