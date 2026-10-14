# vitals-pulse

> Fail CI when Core Web Vitals get worse: LCP, CLS and an INP proxy, gated on thresholds and on regressions against your baseline.

Lighthouse tells you a page is slow; it does not stop the pull request that made it slow. `vitals-pulse` reads the reports you already produce (Lighthouse JSON, Lighthouse CI's `.lighthouseci` folder, PageSpeed Insights API responses, or web-vitals measurements from your RUM) or runs Lighthouse for you, takes the median of several runs per URL, and fails the build when a metric crosses Google's "poor" or "needs improvement" lines or regresses against a snapshot from your main branch.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies** (Lighthouse is only needed for `--url`). By Louis Wright.

## Features

- **Metrics:** LCP, CLS, TBT (Total Blocking Time, the lab proxy for INP), INP (from PSI field data or web-vitals), FCP, TTFB and Speed Index, with the standard good/poor thresholds (LCP 2.5 s / 4 s, CLS 0.1 / 0.25, TBT 200 / 600 ms, INP 200 / 500 ms); override any of them.
- **Stable numbers:** multiple runs per URL are combined with the median, like Lighthouse CI; large run-to-run spread is noted.
- **Regressions:** `--snapshot` saves medians; `--baseline` fails when a metric gets more than `--max-regression` percent worse (default 10%) and by more than a meaningful absolute amount (100 ms LCP, 0.02 CLS, 50 ms TBT).
- **Inputs:** Lighthouse/LHCI/PSI JSON, web-vitals JSON or JSON lines (p75 per URL), any mix of files and directories. Failed Lighthouse runs (`runtimeError`) are reported, not silently skipped.
- **Optional runner:** `--url` runs an installed `lighthouse` CLI (desktop or mobile preset) several times per URL.

### Scope

vitals-pulse gates numbers; it does not diagnose them. Use the per-area tools for causes: image-pulse (images), render-pulse (render-blocking resources), font-pulse (fonts), lazy-pulse (lazy-loading) and bundle-pulse (JavaScript size). Lab TBT is a proxy for INP, not a measurement of it.

## Rules

| Rule | Default severity | What it means |
|---|---|---|
| `vitals-poor` | high | Metric is in the "poor" range |
| `vitals-report-error` | high | Report could not be read or the Lighthouse run failed |
| `vitals-needs-improvement` | medium | Metric is above the "good" threshold |
| `vitals-regression` | medium | Metric regressed against the baseline |
| `vitals-score-low` | low | Lighthouse performance score is below the minimum |
| `vitals-metric-missing` | low | A gated metric is missing from the report |
| `vitals-variance` | info | Runs for the same URL vary a lot (results may be noisy) |
| `vitals-no-reports` | high | No reports were found |
| `allowlist-expired` | medium | An allowlist entry is past its `expires` date |
| `allowlist-unused` | info | An allowlist entry matched nothing |

## Install and run

```bash
npx vitals-pulse .lighthouseci
npx vitals-pulse reports/ --lcp 2000 --min-score 0.9
npx vitals-pulse reports/ --snapshot vitals-base.json   # on main
npx vitals-pulse reports/ --baseline vitals-base.json --max-regression 5
npx vitals-pulse --url https://example.com/ --runs 5 --preset mobile
```

### Sample output

```text
vitals-pulse — test/fixtures/bad
4 URL(s), 4 run(s); worst LCP 4.80 s, CLS 0.310, TBT 750 ms

HIGH     test/fixtures/bad/broken.json test/fixtures/bad/broken.json: Unexpected end of JSON input [vitals-report-error]
HIGH     test/fixtures/bad/lhr-error.json https://example.com/down: ERRORED_DOCUMENT_REQUEST: Lighthouse was unable to reliably load the page (Status code: 500) [vitals-report-error]
HIGH     test/fixtures/bad/lhr-home.json https://example.com/: LCP 4.80 s is poor (> 4.00 s) [vitals-poor]
HIGH     test/fixtures/bad/lhr-home.json https://example.com/: CLS 0.310 is poor (> 0.250) [vitals-poor]
HIGH     test/fixtures/bad/lhr-home.json https://example.com/: TBT (INP proxy) 750 ms is poor (> 600 ms) [vitals-poor]
HIGH     test/fixtures/bad/rum.jsonl https://example.com/app: INP 593 ms is poor (> 500 ms) [vitals-poor]
MEDIUM   test/fixtures/bad/lhr-blog.json https://example.com/blog: LCP 3.10 s needs improvement (> 2.50 s) [vitals-needs-improvement]
```

## Options

```text
vitals-pulse 1.0.0 — gate lab Core Web Vitals from Lighthouse, PSI or web-vitals reports

Usage: vitals-pulse [report.json|dir ...] [options]   (default: .lighthouseci, else the current directory)

Gate
      --metrics <list>         Metrics to gate: lcp, cls, tbt, inp, fcp, ttfb, si (default lcp,cls,tbt,inp)
      --lcp <ms> --cls <n> --tbt <ms> --inp <ms> --fcp <ms> --ttfb <ms>
                               Override the "good" threshold for a metric
      --min-score <0-1>        Minimum Lighthouse performance score
Baseline
      --baseline <file>        Snapshot to compare against (written with --snapshot)
      --baseline-optional      Do not fail if the baseline does not exist yet
      --max-regression <pct>   Allowed regression per metric, in percent (default 10)
      --snapshot <file>        Write the medians as a snapshot
Run Lighthouse (optional; needs the lighthouse CLI and Chrome)
  -u, --url <url>              URL to measure, repeatable
      --runs <n>               Runs per URL, median is used (default 3)
      --preset <p>             desktop (default) or mobile

Common
  -c, --config <file>     JSON config (default: .vitals-pulse.json or "vitalsPulse" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.vitals-pulse.json` (or a `"vitalsPulse"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": {
    "vitals-poor": "low"
  },
  "allowlist": [
    {
      "rule": "vitals-needs-improvement",
      "subject": "https://example.com/blog#cls",
      "reason": "Ad slot CLS tracked in PERF-212",
      "expires": "2027-03-31"
    }
  ],
  "metrics": [
    "lcp",
    "cls",
    "tbt"
  ],
  "thresholds": {
    "lcp": 2000,
    "tbt": {
      "good": 150,
      "poor": 400
    }
  },
  "maxRegression": 5,
  "minScore": 0.9,
  "baseline": "vitals-base.json"
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

The config file is looked up in the target directory first, then in the current directory, so `.vitals-pulse.json` can live at your repository root. Other keys: `metrics`, `thresholds` (a number for the good line, or `{ good, poor }`), `maxRegression`, `minDelta` (per metric), `maxSpread`, `minScore`, `baseline`, `urls`, `runs`, `preset` and `lighthouseCmd`.

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  vitals-pulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - uses: MrLouisWright/vitals-pulse@v1
        with:
          path: .lighthouseci
          fail-on: high
          sarif: vitals-pulse.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: vitals-pulse.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Report file or directory | `.` |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { loadRuns, summarise, evaluate } from "vitals-pulse";
const { runs } = loadRuns([".lighthouseci"]);
const findings = evaluate(summarise(runs), { thresholds: { lcp: 2000 } });
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Licence

MIT © Louis Wright. See [LICENSE](LICENSE).
