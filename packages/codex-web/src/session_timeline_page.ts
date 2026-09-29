import type { TimelineCheckpoint, TimelineIdentity } from './canonical_timeline.js';

/** Page within the already authorized timeline; anchors never bypass visibility filtering. */
export function paginateSessionTimeline<T extends { id?: string; turnId?: string; role?: string; phase?: string; meta?: string; timeline?: TimelineIdentity }>(
  timeline: T[], url: URL, present: (items: T[]) => unknown[] = items => items,
  context?: { sessionId: string; scope: string; checkpoint: TimelineCheckpoint },
) {
  const requested = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(100, Math.floor(requested)) : 50;
  let resetRequired = false;
  function boundary(key: 'before' | 'after'): number | null {
    const raw = url.searchParams.get(key);
    if (!raw || !raw.startsWith('tl1.')) return indexParameter(url, key);
    try {
      const cursor = JSON.parse(Buffer.from(raw.slice(4), 'base64url').toString('utf8'));
      if (!context || cursor.session !== context.sessionId || cursor.scope !== context.scope
        || cursor.generation !== context.checkpoint.generation || !Number.isSafeInteger(cursor.position)) throw new Error('invalid cursor');
      const index = timeline.findIndex(item => item.timeline && (key === 'before'
        ? item.timeline.position >= cursor.position : item.timeline.position > cursor.position));
      return index < 0 ? timeline.length : index;
    } catch { resetRequired = true; return null; }
  }
  const before = boundary('before'), after = boundary('after');
  function cursor(index: number): string {
    const item = timeline[index];
    if (!context || !item?.timeline) return String(index);
    return 'tl1.' + Buffer.from(JSON.stringify({ session: context.sessionId, scope: context.scope,
      generation: context.checkpoint.generation, position: item.timeline.position })).toString('base64url');
  }
  const anchors = url.searchParams.getAll('anchor').slice(0, 3).filter(id => id.length <= 2048);
  let anchorIndex = -1;
  for (const anchor of anchors) {
    anchorIndex = timeline.findIndex(item => item.id === anchor || item.timeline?.aliases.includes(anchor) || (item.role === 'assistant' && item.turnId
      && (item.phase === 'final_answer' || item.meta === 'final') && anchor === `assistant_${item.turnId}_final`));
    if (anchorIndex >= 0) break;
  }
  let end = before === null || resetRequired ? timeline.length : Math.min(timeline.length, before);
  let start = Math.max(0, end - limit);
  if (after !== null && !resetRequired) { start = Math.min(timeline.length, after); end = Math.min(timeline.length, start + limit); }
  else if (anchorIndex >= 0) {
    start = Math.max(0, anchorIndex - Math.floor(limit / 3)); end = Math.min(timeline.length, start + limit);
    start = Math.max(0, end - limit);
  }
  return {
    items: present(timeline.slice(start, end)),
    nextBefore: start > 0 ? cursor(start) : null, hasMore: start > 0,
    nextAfter: end < timeline.length ? (context && timeline[end - 1]?.timeline ? cursor(end - 1) : String(end)) : null, hasNewer: end < timeline.length,
    ...(anchors.length ? { anchorFound: anchorIndex >= 0 } : {}),
    total: timeline.length,
    ...(context ? { timelineCheckpoint: context.checkpoint } : {}),
    ...(resetRequired ? { resetRequired: true } : {}),
  };
}

function indexParameter(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key), value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
