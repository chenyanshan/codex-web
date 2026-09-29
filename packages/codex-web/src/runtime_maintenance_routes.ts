import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeMaintenance } from './runtime_maintenance.js';
import type { RuntimeUpdateService } from './runtime_update.js';

export interface RuntimeMaintenanceRegistration {
  maintenance: RuntimeMaintenance;
  updater: RuntimeUpdateService;
  versions: () => { runningVersion: string | null; [key: string]: unknown };
  webBuild: string;
  protocolVersion: string | null;
}
const registrations = new WeakMap<object, RuntimeMaintenanceRegistration>();
export function registerRuntimeMaintenance(runtime: object, registration: RuntimeMaintenanceRegistration): void { registrations.set(runtime, registration); }
export async function handleRuntimeMaintenanceRoute(input: {
  runtime: object;
  principal: { isAdmin: boolean };
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  method: string;
  readJsonBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
}): Promise<boolean> {
  const { pathname, method, response } = input;
  if (!['/api/runtime/status', '/api/runtime/check', '/api/runtime/maintenance', '/api/runtime/maintenance/cancel'].includes(pathname)) return false;
  const send = (status: number, payload: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(payload)); };
  if (!input.principal.isAdmin) { send(403, { error: 'forbidden' }); return true; }
  const registration = registrations.get(input.runtime);
  if (!registration) { send(501, { error: 'runtime_maintenance_unavailable' }); return true; }
  const { maintenance, updater } = registration;
  const status = () => ({ ...updater.status(), ...registration.versions(), webBuild: registration.webBuild, protocolVersion: registration.protocolVersion, operation: maintenance.status() });
  try {
    if (pathname === '/api/runtime/status' && method === 'GET') { send(200, status()); return true; }
    if (pathname === '/api/runtime/check' && method === 'POST') {
      await updater.refresh();
      let targetVersion: string | null = null;
      if (updater.status().updateSupported) targetVersion = await updater.resolveStableTarget();
      send(200, { ...status(), targetVersion }); return true;
    }
    if (pathname === '/api/runtime/maintenance' && method === 'POST') {
      const body = await input.readJsonBody(input.request);
      if (typeof body.id !== 'string' || !['apply_installed', 'upgrade'].includes(String(body.kind)) || (body.targetVersion !== undefined && typeof body.targetVersion !== 'string')) { send(400, { error: 'invalid_maintenance_request' }); return true; }
      if (body.kind === 'upgrade' && !updater.status().updateSupported) { send(409, { error: 'unsupported_installation' }); return true; }
      const operation = await maintenance.schedule({ id: body.id, kind: body.kind as 'apply_installed' | 'upgrade', targetVersion: body.targetVersion as string | undefined });
      // The operation owns its lifecycle, not this HTTP connection.
      void maintenance.tick().catch(() => {});
      send(202, { operation }); return true;
    }
    if (pathname === '/api/runtime/maintenance/cancel' && method === 'POST') {
      const body = await input.readJsonBody(input.request);
      send(200, { operation: await maintenance.cancel(String(body.id ?? '')) }); return true;
    }
    send(405, { error: 'method_not_allowed' });
  } catch {
    send(409, { error: 'runtime_maintenance_conflict', operation: maintenance.status(), message: 'Read runtime status before retrying. An uncertain operation is never automatically repeated.' });
  }
  return true;
}
