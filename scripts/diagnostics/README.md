# Local browser soak

## Allocation sampling on an existing browser

`browser-allocation-profile.mjs` uses Node 24's built-in WebSocket and raw CDP. It does not launch a browser. Chrome must already expose a local debugging endpoint. Select an explicit page target ID from that browser's `/json/list`; the recorder does not select a page by its title or read page text, cookies or tokens.

```sh
node scripts/diagnostics/browser-allocation-profile.mjs --cdp=http://127.0.0.1:9222 --target-id=EXISTING_PAGE_ID --output="$HOME/diagnostics/codex-allocation"
```

To capture allocations **before growth begins**, create a new blank page, start profiling, then navigate using `--url` instead of `--target-id`:

```sh
node scripts/diagnostics/browser-allocation-profile.mjs --url=https://example.com/ --duration-seconds=300 --output="$HOME/diagnostics/codex-allocation"
```

An attached existing page is never navigated. New pages are left open after recording. The tool never refreshes/closes a page, kills the browser, increases its heap allowance, forces GC, or automatically takes a heap snapshot. Do not attach while another profiler is sampling the same target: CDP profilers are shared target facilities, not independent sessions.

Defaults: five minutes, 65,536-byte allocation sampling interval, metrics every two seconds, a heap allocation profile every five seconds, five-second timeout per CDP command. Sampling includes allocations subsequently collected by minor or major GC, so churn remains visible. Override duration, `--sampling-interval=65536`, or `--command-timeout-ms=5000` if needed. Probes are sequential; a slow response can delay the requested cadence. A command timeout clears pending commands and stops further regular probes; bounded final CPU/heap profile requests are still attempted. Ctrl-C also attempts finalization and disconnects only the recorder's CDP connection.

The output argument must be a directory. Each run creates a private subdirectory (0700) and files (0600), preferably outside the repository. The console prints `timeline.jsonl`, containing timestamped heap/DOM metrics, macOS host pressure, profile paths, pruning records, and stop reason. The initial allocation profile and at most the latest 20 profiles are retained; `final.cpuprofile` is saved separately when finalization succeeds. Source URLs/function names can occur in profiles and can themselves contain sensitive URL parameters: treat all artifacts as private even though the recorder never requests credentials or page contents. File-count retention is not a byte quota; one unusually large profile can still consume substantial disk space.

At JS heap usage above 256 MiB the recorder stops and leaves the user's page running; this boundary also applies before sampling starts. macOS memory pressure >=2 refuses new-page creation/navigation and stops new-page recording. Existing-page attachment may continue passive observation under pressure, subject to the heap boundary. Unsupported/unreadable host pressure is recorded as unknown, never as healthy. Sampling and CPU profiling still add overhead; attachment after a page has already hung may only yield a timeout, not a useful profile.

Sampling profiles identify allocation stacks, **not retained heap size or retaining paths**. Starting before growth helps attribute allocations but does not prove what remains reachable after completion/navigation/GC. Compare metrics at equivalent lifecycle points; obtain a carefully bounded heap snapshot when retaining paths are needed. This recorder does not identify a renderer PID or measure its RSS. Correlate those separately: native allocations such as ICU date formatters may increase renderer memory without a comparable JS heap increase. No long-run production conclusion follows from a short recording or from allocation totals alone.

Local mock checks (no browser startup):

```sh
node scripts/diagnostics/browser-allocation-profile.mjs --help
node --test scripts/diagnostics/browser-allocation-profile.test.mjs
```

## Dedicated synthetic soak

`browser-soak.mjs` runs a synthetic fixture in a dedicated Chromium instance on a random localhost port. It rejects non-fixture browser traffic, uses a shared synthetic account across two isolated tabs, and never connects to production. It is deliberately excluded from the default test suite.

```sh
node scripts/diagnostics/browser-soak.mjs --duration-seconds=1800 --output=test-results/soak-current
```

Defaults: 30-second cycles, 30-minute requested workload, 1 GiB per-tab JS heap limit, 2 GiB dedicated browser process-tree RSS limit. `--cycle-seconds=30` and `--browser-rss-limit-mib=2048` can override the cycle delay and RSS limit. macOS host memory pressure level >=2 refuses startup or stops the dedicated test browser. The guard checks startup, samples and every two seconds; it never stops user processes. Failure/pressure observations are written to the summary. Unsupported/unreadable host pressure is not claimed as healthy.

Each cycle activates both tabs, switches sessions, delivers roughly 120 KiB of incremental assistant output via real fixture SSE, emits completion, switches away, then collects garbage and metrics. Tab 0 stays alive; tab 1 reloads every third cycle. Headless Chromium reports tabs natively visible, so an isolated init script drives visibility/focus events; this does not reproduce OS suspension. The fixture restores fixed history after switching; it is not a production app-server workload.

Output includes `samples.json`, `samples.csv`, `summary.json`, fixture logs and initial/middle/final heap snapshots for both tabs. Snapshots are capped at 256 MiB each. CDP records JS heap, DOM and listener counts; request tracking records status/timeline counts, one-second request peaks, concurrent requests and SSE requests. Process RSS is the sum of the dedicated browser tree, **not per-tab memory**, and can double-count shared pages. GC and snapshots perturb timing. Heap growth during output must be distinguished from retention after completion/switch/GC.

For a before/after comparison, extract the baseline public directory to a temporary location without overwriting the worktree:

```sh
baseline_dir=$(mktemp -d)
git archive HEAD packages/codex-web/public | tar -x -C "$baseline_dir"
node scripts/diagnostics/browser-soak.mjs --duration-seconds=1800 --cycle-seconds=30 --public-root="$baseline_dir/packages/codex-web/public" --output=test-results/soak-before
node scripts/diagnostics/browser-soak.mjs --duration-seconds=1800 --cycle-seconds=30 --output=test-results/soak-after
```

Run sequentially under comparable, healthy host conditions. Record the baseline commit separately; the summary records the source directory/hash, harness checkout HEAD/dirty status and browser version. Keep all parameters, browser version and workload the same. Artifacts under `test-results/` are gitignored. Compare the persistent tab separately from the reloaded tab. No universal retained-heap slope pass threshold is asserted by this harness.

This change was checked with short 12/15/24-second fixture smoke runs. The intended 30-minute comparison was **not performed in this session** because the host reported macOS memory-pressure warning. Short smoke success does not establish long-run memory stability or explain the historical production crashes.
