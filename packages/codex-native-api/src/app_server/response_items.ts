import type { ThreadItem } from './generated/stable/v2/ThreadItem.js';
import type { ProviderResponseItem } from '../provider.js';

/** Preserve the Responses facade contract while the wire uses typed ThreadItem.
 * Tool calls are projections of the official execution record, not reconstructed
 * model-private arguments. Reasoning exports summaries only.
 */
export function toProviderResponseItems(rawItems: readonly Record<string, unknown>[]): ProviderResponseItem[] {
  return rawItems.flatMap((raw): ProviderResponseItem[] => {
    if (!raw || typeof raw.id !== 'string' || typeof raw.type !== 'string') return [];
    const item = raw as ThreadItem;
    const call = (name: string, args: unknown, output: unknown): ProviderResponseItem[] => [
      { id: `${item.id}:call`, type: 'function_call', call_id: item.id, name, arguments: JSON.stringify(args) },
      { id: `${item.id}:output`, type: 'function_call_output', call_id: item.id, output: typeof output === 'string' ? output : JSON.stringify(output) },
    ];
    switch (item.type) {
      case 'agentMessage': return [{ id: item.id, type: 'message', role: 'assistant', phase: item.phase,
        content: [{ type: 'output_text', text: item.text, annotations: [] }] }];
      case 'reasoning': return [{ id: item.id, type: 'reasoning', summary: (item.summary ?? []).map((text) => ({ type: 'summary_text', text })) }];
      case 'commandExecution': return call('exec_command', { command: item.command, cwd: item.cwd }, { output: item.aggregatedOutput, exitCode: item.exitCode, status: item.status });
      case 'fileChange': return call('apply_patch', { changes: item.changes }, { status: item.status, changes: item.changes });
      case 'mcpToolCall': return call(`${item.server}/${item.tool}`, item.arguments, item.result ?? item.error);
      case 'dynamicToolCall': return call(item.namespace ? `${item.namespace}/${item.tool}` : item.tool, item.arguments, { content: item.contentItems, success: item.success });
      case 'functionCallOutput': return [{ id: item.id, type: 'function_call_output', call_id: item.id, output: item.output }];
      default: return ['message', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(raw.type) ? [raw] : [];
    }
  });
}
