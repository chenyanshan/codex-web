export function normalizeSessionName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 120 ? name : null;
}
