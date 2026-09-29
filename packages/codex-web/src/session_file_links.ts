import path from 'node:path';
import type { CodexWebSession } from './runtime.js';

const MAX_LINKED_FILE_PATHS = 256;
const MARKDOWN_LINK_PATTERN = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s)\\])+))(?:\s+["'][^"'\n]*["'])?\s*\)/gu;

export function assistantLinkedAbsoluteFilePaths(session: CodexWebSession): string[] {
  const paths = new Set<string>();
  for (const message of session.timeline ?? []) {
    if (message.role !== 'assistant' || typeof message.text !== 'string') {
      continue;
    }
    for (const match of message.text.matchAll(MARKDOWN_LINK_PATTERN)) {
      const normalized = normalizeLinkedFileTarget(match[1] ?? match[2] ?? '');
      if (!normalized) {
        continue;
      }
      paths.add(normalized);
      if (paths.size >= MAX_LINKED_FILE_PATHS) {
        return [...paths];
      }
    }
  }
  return [...paths];
}

function normalizeLinkedFileTarget(value: string): string | null {
  let normalized = value.trim()
    .replaceAll('\\)', ')')
    .replaceAll('\\(', '(')
    .replaceAll('\\ ', ' ');
  normalized = normalized.replace(/[?#].*$/u, '').replace(/:\d+(?::\d+)?$/u, '');
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    return null;
  }
  return path.isAbsolute(normalized) ? path.resolve(normalized) : null;
}
