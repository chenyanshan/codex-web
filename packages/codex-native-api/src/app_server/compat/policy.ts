/** Rollout compatibility is restricted to the pre-migration 0.153.x baseline.
 * Uninitialized facade consumers are legacy injected providers/tests, not a live
 * negotiated connection. New and unknown server versions use official snapshots.
 * Exit: remove after 0.153.x support and its raw Responses facade are retired.
 */
export function needsLegacyRolloutRecovery(userAgent: string | null): boolean {
  return userAgent === null || /\b0\.153\.\d+\b/u.test(userAgent);
}
