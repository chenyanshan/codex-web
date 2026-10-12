# Local browser soak

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
