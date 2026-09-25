import type { TurnStartParams as ExperimentalTurnStartParams } from './generated/experimental/v2/TurnStartParams.js';
import type { ThreadStartParams as ExperimentalThreadStartParams } from './generated/experimental/v2/ThreadStartParams.js';
import type { ThreadListResponse } from './generated/stable/v2/ThreadListResponse.js';
import type { ThreadReadResponse } from './generated/stable/v2/ThreadReadResponse.js';
import type { ThreadStartResponse } from './generated/stable/v2/ThreadStartResponse.js';
import type { ThreadResumeResponse } from './generated/stable/v2/ThreadResumeResponse.js';
import type { ThreadSetNameResponse } from './generated/stable/v2/ThreadSetNameResponse.js';
import type { ThreadArchiveResponse } from './generated/stable/v2/ThreadArchiveResponse.js';
import type { ThreadUnarchiveResponse } from './generated/stable/v2/ThreadUnarchiveResponse.js';
import type { ThreadUnsubscribeResponse } from './generated/stable/v2/ThreadUnsubscribeResponse.js';
import type { ThreadGoalGetResponse } from './generated/stable/v2/ThreadGoalGetResponse.js';
import type { ThreadGoalSetResponse } from './generated/stable/v2/ThreadGoalSetResponse.js';
import type { ThreadGoalClearResponse } from './generated/stable/v2/ThreadGoalClearResponse.js';
import type { TurnStartResponse } from './generated/stable/v2/TurnStartResponse.js';
import type { TurnSteerResponse } from './generated/stable/v2/TurnSteerResponse.js';
import type { TurnInterruptResponse } from './generated/stable/v2/TurnInterruptResponse.js';
import type { ModelListResponse } from './generated/stable/v2/ModelListResponse.js';
import type { ConfigReadResponse } from './generated/stable/v2/ConfigReadResponse.js';
import type { GetAccountRateLimitsResponse } from './generated/stable/v2/GetAccountRateLimitsResponse.js';
import type { SkillsListResponse } from './generated/stable/v2/SkillsListResponse.js';
import type { SkillsConfigWriteResponse } from './generated/stable/v2/SkillsConfigWriteResponse.js';
import type { PluginListResponse } from './generated/stable/v2/PluginListResponse.js';
import type { PluginReadResponse } from './generated/stable/v2/PluginReadResponse.js';
import type { PluginInstallResponse } from './generated/stable/v2/PluginInstallResponse.js';
import type { PluginUninstallResponse } from './generated/stable/v2/PluginUninstallResponse.js';
import type { AppsListResponse } from './generated/stable/v2/AppsListResponse.js';
import type { ListMcpServerStatusResponse } from './generated/stable/v2/ListMcpServerStatusResponse.js';
import type { McpServerOauthLoginResponse } from './generated/stable/v2/McpServerOauthLoginResponse.js';
import type { ConfigWriteResponse } from './generated/stable/v2/ConfigWriteResponse.js';
import type { LegacyThreadStartFields, LegacyThreadResumeFields } from './compat/request_params.js';
import type { ClientRequest } from './generated/stable/ClientRequest.js';
import type { InitializeResponse } from './generated/stable/InitializeResponse.js';
import { request, type TransportHost } from './transport.js';

export type AppServerMethod = ClientRequest['method'];
type GeneratedParams<M extends AppServerMethod> = Extract<ClientRequest, { method: M }>['params'];
// ts-rs maps u64 to bigint, whereas the JSON wire encodes timeoutSecs as a number.
export type AppServerParams<M extends AppServerMethod> = M extends 'mcpServer/oauth/login'
  ? Omit<GeneratedParams<M>, 'timeoutSecs'> & { timeoutSecs?: number | null }
  : M extends 'thread/start' ? GeneratedParams<M> & LegacyThreadStartFields & Pick<ExperimentalThreadStartParams, 'experimentalRawEvents'>
  : M extends 'turn/start' ? GeneratedParams<M> & Pick<ExperimentalTurnStartParams, 'collaborationMode'>
  : M extends 'thread/resume' ? GeneratedParams<M> & LegacyThreadResumeFields : GeneratedParams<M>;

type Responses = { initialize: InitializeResponse; 'config/mcpServer/reload': Record<string, never>;
  'thread/list': ThreadListResponse;
  'thread/read': ThreadReadResponse;
  'thread/start': ThreadStartResponse;
  'thread/resume': ThreadResumeResponse;
  'thread/name/set': ThreadSetNameResponse;
  'thread/archive': ThreadArchiveResponse;
  'thread/unarchive': ThreadUnarchiveResponse;
  'thread/unsubscribe': ThreadUnsubscribeResponse;
  'thread/goal/get': ThreadGoalGetResponse;
  'thread/goal/set': ThreadGoalSetResponse;
  'thread/goal/clear': ThreadGoalClearResponse;
  'turn/start': TurnStartResponse;
  'turn/steer': TurnSteerResponse;
  'turn/interrupt': TurnInterruptResponse;
  'model/list': ModelListResponse;
  'config/read': ConfigReadResponse;
  'account/rateLimits/read': GetAccountRateLimitsResponse;
  'skills/list': SkillsListResponse;
  'skills/config/write': SkillsConfigWriteResponse;
  'plugin/list': PluginListResponse;
  'plugin/read': PluginReadResponse;
  'plugin/install': PluginInstallResponse;
  'plugin/uninstall': PluginUninstallResponse;
  'app/list': AppsListResponse;
  'mcpServerStatus/list': ListMcpServerStatusResponse;
  'mcpServer/oauth/login': McpServerOauthLoginResponse;
  'config/value/write': ConfigWriteResponse;
};
export type AppServerResponse<M extends AppServerMethod> = M extends keyof Responses ? Responses[M] : unknown;
/** Typed wire entry point used by the legacy facade; no second connection or state. */
export async function callAppServer<M extends AppServerMethod>(host: TransportHost, method: M, params: AppServerParams<M>, timeoutMs?: number): Promise<AppServerResponse<M>> {
  const result = await request(host, method, params, timeoutMs);
  if (method === 'turn/start' && (!result?.turn || typeof result.turn.id !== 'string' || typeof result.turn.status !== 'string')) {
    throw new Error('Invalid Codex turn/start response');
  }
  if (method === 'thread/read' && (!result?.thread || typeof result.thread.id !== 'string')) {
    throw new Error('Invalid Codex thread/read response');
  }
  return result;
}

export function wireEnum<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!allowed.includes(value as T)) throw new Error(`Unsupported ${name}: ${value}`);
  return value as T;
}
