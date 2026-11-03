import { readIdentitySnapshot, type FileIdentityStore } from './identity_store.js';

type ImportStore = Pick<FileIdentityStore, 'readState'> & Partial<Pick<FileIdentityStore,
  'readSnapshot' | 'initializeLegacySessionImport'>>;
const captures = new WeakMap<ImportStore, Promise<void>>();

/** Freeze the historical scope before any multi-user thread can become visible. */
export async function ensureLegacySessionImportScope(
  store: ImportStore,
  listSessions: () => Promise<Array<{ id: string }>>,
): Promise<void> {
  if (!store.initializeLegacySessionImport) throw new Error('Identity store does not support safe legacy session import');
  const pending = captures.get(store);
  if (pending) return pending;
  const capture = (async () => {
    if ((await readIdentitySnapshot(store)).legacySessionImport) return;
    // Use the complete directory, never a UI page or a timestamp heuristic.
    const sessions = await listSessions();
    await store.initializeLegacySessionImport!(sessions.map((session) => session.id));
  })();
  captures.set(store, capture);
  try {
    await capture;
  } finally {
    if (captures.get(store) === capture) captures.delete(store);
  }
}
