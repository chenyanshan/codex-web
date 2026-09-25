/** 0.153.4 request defaults retained while validating 0.156.1.
 * Serde ignores these extensions in 0.156.1. Remove after the compatibility
 * window excludes old raw-event/history behavior and equivalent fixtures pass.
 */
export type LegacyThreadStartFields = { persistExtendedHistory?: boolean };
export type LegacyThreadResumeFields = { experimentalRawEvents?: boolean; persistExtendedHistory?: boolean };
