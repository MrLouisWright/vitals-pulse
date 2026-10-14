#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { mainCli, check, RULES, splitList, UsageError } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const num = (v, name) => { if (v == null) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number`); return n; };
mainCli({
  name: 'vitals-pulse', version: pkg.version, configKey: 'vitalsPulse', rules: RULES,
  tagline: 'gate lab Core Web Vitals from Lighthouse, PSI or web-vitals reports',
  usage: 'Usage: vitals-pulse [report.json|dir ...] [options]   (default: .lighthouseci, else the current directory)',
  dirFrom: (o, p) => (p[0] && existsSync(p[0]) ? (statSync(p[0]).isFile() ? dirname(p[0]) : p[0]) : '.'),
  help: `Gate
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
`,
  options: { metrics: { type: 'string', multiple: true }, lcp: { type: 'string' }, cls: { type: 'string' }, tbt: { type: 'string' }, inp: { type: 'string' }, fcp: { type: 'string' }, ttfb: { type: 'string' }, 'min-score': { type: 'string' }, baseline: { type: 'string' }, 'baseline-optional': { type: 'boolean' }, 'max-regression': { type: 'string' }, snapshot: { type: 'string' }, url: { type: 'string', short: 'u', multiple: true }, runs: { type: 'string' }, preset: { type: 'string' } },
  run: async ({ positionals, values: o, config, configFile }) => {
    const thresholds = {}; for (const k of ['lcp', 'cls', 'tbt', 'inp', 'fcp', 'ttfb']) if (o[k] != null) thresholds[k] = num(o[k], k);
    const metrics = splitList(o.metrics); for (const m of metrics) if (!['lcp', 'cls', 'tbt', 'inp', 'fcp', 'ttfb', 'si'].includes(m)) throw new UsageError(`Unknown metric: ${m}`);
    return check(positionals, { metrics, thresholds, minScore: num(o['min-score'], 'min-score'), baseline: o.baseline, baselineOptional: o['baseline-optional'], maxRegression: num(o['max-regression'], 'max-regression'), snapshot: o.snapshot, urls: o.url || [], runs: num(o.runs, 'runs'), preset: o.preset, toolVersion: pkg.version }, config, configFile);
  },
});
