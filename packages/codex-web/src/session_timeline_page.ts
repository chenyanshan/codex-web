/** Page within the already authorized timeline; anchors never bypass visibility filtering. */
export function paginateSessionTimeline<T extends { id?: string; turnId?: string; role?: string; phase?: string; meta?: string }>(
  timeline: T[], url: URL, present: (items: T[]) => unknown[] = items => items,
) {
  const requested = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(100, Math.floor(requested)) : 50;
  const before = indexParameter(url, 'before'), after = indexParameter(url, 'after');
  const anchors = url.searchParams.getAll('anchor').slice(0, 3).filter(id => id.length <= 2048);
  let anchorIndex = -1;
  for (const anchor of anchors) {
    anchorIndex = timeline.findIndex(item => item.id === anchor || (item.role === 'assistant' && item.turnId
      && (item.phase === 'final_answer' || item.meta === 'final') && anchor === `assistant_${item.turnId}_final`));
    if (anchorIndex >= 0) break;
  }
  let end = before === null ? timeline.length : Math.min(timeline.length, before);
  let start = Math.max(0, end - limit);
  if (after !== null) { start = Math.min(timeline.length, after); end = Math.min(timeline.length, start + limit); }
  else if (anchorIndex >= 0) {
    start = Math.max(0, anchorIndex - Math.floor(limit / 3)); end = Math.min(timeline.length, start + limit);
    start = Math.max(0, end - limit);
  }
  return {
    items: present(timeline.slice(start, end)),
    nextBefore: start > 0 ? String(start) : null, hasMore: start > 0,
    nextAfter: end < timeline.length ? String(end) : null, hasNewer: end < timeline.length,
    ...(anchors.length ? { anchorFound: anchorIndex >= 0 } : {}),
    total: timeline.length,
  };
}

function indexParameter(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key), value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
