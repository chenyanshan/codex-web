import type { InitializeParams } from './generated/stable/InitializeParams.js';
import type { InitializeResponse } from './generated/stable/InitializeResponse.js';

/** Experimental capabilities retained for existing product features, not discovery probes. */
export const EXPERIMENTAL_DEPENDENCIES = [
  { feature: 'collaboration-mode', methods: ['turn/start'], reason: 'Existing plan/default collaboration settings require experimental collaborationMode field', exit: 'Stable equivalent field and plan-mode parity verified' },
  { feature: 'raw-events', methods: ['thread/start', 'thread/resume'], reason: 'Legacy tool and reasoning projections', exit: 'Official item history parity verified' },
] as const;
export function initializeParams(clientInfo: InitializeParams['clientInfo']): InitializeParams {
  return { clientInfo, capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: [
    'codex/event/agent_reasoning_delta', 'codex/event/reasoning_content_delta', 'codex/event/reasoning_raw_content_delta',
  ] } };
}
export function validateInitialize(value: unknown): InitializeResponse {
  if (!value || typeof value !== 'object' || typeof (value as InitializeResponse).userAgent !== 'string') {
    throw new Error('Invalid Codex initialize response: missing userAgent');
  }
  // Older supported releases omit platform metadata. Only userAgent is required by the facade.
  return value as InitializeResponse;
}
export function isUnsupportedMethod(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'rpcCode' in error && error.rpcCode === -32601);
}
