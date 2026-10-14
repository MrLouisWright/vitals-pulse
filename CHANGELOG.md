# Changelog

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Reads Lighthouse JSON, Lighthouse CI `.lighthouseci/` output, PageSpeed Insights API responses (lab and field data) and web-vitals JSON/JSON lines (p75).
- Median per URL across runs; LCP, CLS, TBT (lab INP proxy), INP, FCP, TTFB and Speed Index with Google's good/poor thresholds, overridable.
- Baseline snapshots with percentage and absolute regression gates; minimum performance score; run-to-run variance notes.
- Optional `--url` mode that runs an installed Lighthouse CLI.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
