import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

export type HttpRouteCategory = 'static' | 'health' | 'auth' | 'sessions' | 'status' | 'history' | 'admin' | 'upload' | 'report' | 'files' | 'events' | 'api' | 'other';
const categories: HttpRouteCategory[] = ['static', 'health', 'auth', 'sessions', 'status', 'history', 'admin', 'upload', 'report', 'files', 'events', 'api', 'other'];
export function classifyHttpRoute(pathname: string, method = 'GET'): HttpRouteCategory {
  if (pathname === '/healthz' || pathname === '/api/health') return 'health';
  if (!pathname.startsWith('/api/')) return method === 'GET' || method === 'HEAD' ? 'static' : 'other';
  if (/\/events$/u.test(pathname)) return 'events';
  if (/\/(?:files\/[^/]+\/content|reports\/[^/]+\/download)$/u.test(pathname)) return 'files';
  if (/\/(?:attachments|session-submission-attachments)$/u.test(pathname)) return 'upload';
  if (/^\/api\/auth\//u.test(pathname)) return 'auth';
  if (/^\/api\/(?:share\/[^/]+\/)?reports(?:\/|$)/u.test(pathname)) return 'report';
  if (/\/sessions\/[^/]+\/timeline$/u.test(pathname)) return 'history';
  if (/\/sessions\/[^/]+\/status$/u.test(pathname)) return 'status';
  if (pathname.startsWith('/api/admin/')) return 'admin';
  if (pathname === '/api/sessions') return 'sessions';
  return 'api';
}
const sample = (values: number[], value: number, limit: number) => { if (values.length >= limit) values.shift(); values.push(value); };
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(Math.max(0, values.length - 1) * 0.95)] ?? 0;
const counters = () => ({ requests: 0, errors: 0, active: 0, aborted: 0, clientErrors: 0, durations: [] as number[] });

export class HttpMetrics {
  private readonly loop = monitorEventLoopDelay({ resolution: 10 });
  private readonly overall = counters();
  private readonly routes = Object.fromEntries(categories.map(name => [name, counters()])) as Record<HttpRouteCategory, ReturnType<typeof counters>>;
  private readonly startedAt: number;
  private replays = 0;
  private resets = 0;
  private streams = 0;
  private streamsOpened = 0;
  private historyPages = 0;
  private historyItems = 0;
  private readonly historyPageSizes: number[] = [];
  constructor(private readonly now = () => performance.now()) { this.startedAt = now(); this.loop.enable(); }
  begin(pathname = '/api/unknown', method = 'GET'): (status: number, aborted?: boolean) => void {
    const category = classifyHttpRoute(pathname, method), route = this.routes[category];
    route.active++; this.overall.active++;
    const started = this.now();
    let done = false;
    return (status, aborted = false) => {
      if (done) return;
      done = true;
      for (const counter of [route, this.overall]) {
        counter.active--; counter.requests++;
        if (status >= 500) counter.errors++;
        if (status >= 400 && status < 500) counter.clientErrors++;
        if (aborted) counter.aborted++;
      }
      const duration = this.now() - started;
      if (!aborted) {
        sample(route.durations, duration, 256);
        // Streaming handshake is measured separately; static asset and health traffic
        // must not dominate the diagnostic API latency distribution.
        if (!['events', 'files', 'static', 'health', 'other'].includes(category)) sample(this.overall.durations, duration, 1024);
      }
    };
  }
  streamOpened(): () => void {
    this.streams++; this.streamsOpened++;
    let closed = false;
    return () => { if (!closed) { closed = true; this.streams--; } };
  }
  replay(reset: boolean) { this.replays++; if (reset) this.resets++; }
  historyPage(items: number) { this.historyPages++; this.historyItems += items; sample(this.historyPageSizes, items, 256); }
  snapshot() {
    const present = (value: ReturnType<typeof counters>) => ({ requests: value.requests, errors: value.errors, active: value.active, aborted: value.aborted, clientErrors: value.clientErrors, samples: value.durations.length, requestP95Ms: p95(value.durations) });
    return { ...present(this.overall), uptimeSeconds: Math.floor((this.now() - this.startedAt) / 1000),
      eventLoopP95Ms: this.loop.percentile(95) / 1e6, sseReplays: this.replays, sseResets: this.resets,
      activeStreams: this.streams, streamsOpened: this.streamsOpened,
      history: { pages: this.historyPages, items: this.historyItems, pageItemsP95: p95(this.historyPageSizes) },
      routes: Object.fromEntries(categories.map(name => [name, present(this.routes[name])])) };
  }
  stop() { this.loop.disable(); }
}
