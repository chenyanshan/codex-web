import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProviderTurnSessionSettings } from '@codex-mobile-web-app/codex-native-api';

export interface ScheduledTaskSchedule {
  kind: 'daily';
  time: string;
}

export interface ScheduledTaskArchivePolicy {
  onCompletion: boolean;
}

export interface ScheduledTaskDefinition {
  id: string;
  title: string;
  cwd: string | null;
  projectId: string | null;
  runAsUserId: string | null;
  schedule: ScheduledTaskSchedule;
  settings: Partial<ProviderTurnSessionSettings>;
  archive: ScheduledTaskArchivePolicy;
  prompt: string;
  taskDir: string;
}

export class FileScheduledTaskStore {
  private readonly tasksDir: string;

  constructor({ stateDir, tasksDir }: { stateDir?: string; tasksDir?: string }) {
    const resolvedTasksDir = tasksDir ?? (stateDir ? path.join(stateDir, 'tasks') : null);
    if (!resolvedTasksDir) {
      throw new Error('Either stateDir or tasksDir is required');
    }
    this.tasksDir = resolvedTasksDir;
  }

  async readTask(taskId: string): Promise<ScheduledTaskDefinition> {
    const id = normalizeTaskId(taskId);
    const taskDir = path.join(this.tasksDir, id);
    const [rawConfig, prompt] = await Promise.all([
      fs.readFile(path.join(taskDir, 'task.json'), 'utf8'),
      fs.readFile(path.join(taskDir, 'prompt.md'), 'utf8'),
    ]);
    const parsed = parseJsonObject(rawConfig, path.join(taskDir, 'task.json'));
    return normalizeTaskDefinition({
      id,
      taskDir,
      raw: parsed,
      prompt,
    });
  }
}

export function isValidScheduledTaskId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function normalizeTaskId(value: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!isValidScheduledTaskId(id)) {
    throw new Error('Invalid scheduled task id. Use letters, numbers, dots, underscores, or dashes.');
  }
  return id;
}

function normalizeTaskDefinition({
  id,
  taskDir,
  raw,
  prompt,
}: {
  id: string;
  taskDir: string;
  raw: Record<string, unknown>;
  prompt: string;
}): ScheduledTaskDefinition {
  const normalizedPrompt = typeof prompt === 'string' ? prompt : '';
  if (!normalizedPrompt.trim()) {
    throw new Error('prompt.md must contain non-empty text');
  }
  return {
    id,
    title: normalizeOptionalString(raw.title) ?? id,
    cwd: normalizeOptionalString(raw.cwd),
    projectId: normalizeOptionalString(raw.projectId),
    runAsUserId: normalizeOptionalString(raw.runAsUserId),
    schedule: normalizeSchedule(raw.schedule),
    settings: normalizeSettings(raw.settings),
    archive: normalizeArchivePolicy(raw.archive),
    prompt: normalizedPrompt,
    taskDir,
  };
}

function normalizeSchedule(value: unknown): ScheduledTaskSchedule {
  if (!isRecord(value)) {
    throw new Error('schedule.kind must be daily');
  }
  if (value.kind !== 'daily') {
    throw new Error('schedule.kind must be daily');
  }
  const time = normalizeOptionalString(value.time);
  if (!time || !isValidDailyTime(time)) {
    throw new Error('schedule.time must use HH:mm in 24-hour time');
  }
  return {
    kind: 'daily',
    time,
  };
}

function normalizeArchivePolicy(value: unknown): ScheduledTaskArchivePolicy {
  if (!isRecord(value)) {
    return { onCompletion: true };
  }
  return {
    onCompletion: typeof value.onCompletion === 'boolean' ? value.onCompletion : true,
  };
}

function normalizeSettings(value: unknown): Partial<ProviderTurnSessionSettings> {
  if (!isRecord(value)) {
    return {};
  }
  const settings: Partial<ProviderTurnSessionSettings> = {};
  assignNullableString(settings, 'model', value.model);
  assignNullableString(settings, 'reasoningEffort', value.reasoningEffort);
  assignNullableString(settings, 'serviceTier', value.serviceTier);
  assignNullableString(settings, 'approvalPolicy', value.approvalPolicy);
  assignNullableString(settings, 'sandboxMode', value.sandboxMode);
  assignNullableString(settings, 'locale', value.locale);
  if (value.collaborationMode === 'plan' || value.collaborationMode === 'default') {
    settings.collaborationMode = value.collaborationMode;
  }
  if (value.personality === 'friendly' || value.personality === 'pragmatic' || value.personality === 'none') {
    settings.personality = value.personality;
  }
  if (value.accessPreset === 'read-only' || value.accessPreset === 'default' || value.accessPreset === 'full-access') {
    settings.accessPreset = value.accessPreset;
  }
  return settings;
}

function assignNullableString<T extends Record<string, unknown>>(
  target: T,
  key: keyof T,
  value: unknown,
): void {
  const normalized = normalizeOptionalString(value);
  if (normalized) {
    target[key] = normalized as T[keyof T];
  }
}

function parseJsonObject(raw: string, filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the shared validation error.
  }
  throw new Error(`${filePath} must contain a JSON object`);
}

function isValidDailyTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
