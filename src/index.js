// vitals-pulse: gate lab Core Web Vitals (LCP, CLS, TBT as INP proxy, FCP, TTFB) from Lighthouse, Lighthouse CI,
// PageSpeed Insights or web-vitals reports, with thresholds and regressions against a baseline. Zero deps. Louis Wright, MIT.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReport, UsageError } from './core.js';

export * from './core.js';

export const RULES = {
  'vitals-poor': { severity: 'high', title: 'Metric is in the "poor" range' },
  'vitals-report-error': { severity: 'high', title: 'Report could not be read or the Lighthouse run failed' },
  'vitals-needs-improvement': { severity: 'medium', title: 'Metric is above the "good" threshold' },
  'vitals-regression': { severity: 'medium', title: 'Metric regressed against the baseline' },
  'vitals-score-low': { severity: 'low', title: 'Lighthouse performance score is below the minimum' },
  'vitals-metric-missing': { severity: 'low', title: 'A gated metric is missing from the report' },
  'vitals-variance': { severity: 'info', title: 'Runs for the same URL vary a lot (results may be noisy)' },
  'vitals-no-reports': { severity: 'high', title: 'No reports were found' },
};

/** Thresholds (good, poor) per metric; units: ms except CLS. INP is field/RUM; TBT is the lab proxy. */
export const METRICS = {
  lcp: { label: 'LCP', good: 2500, poor: 4000, delta: 100, unit: 'ms' },
  cls: { label: 'CLS', good: 0.1, poor: 0.25, delta: 0.02, unit: '' },
  tbt: { label: 'TBT (INP proxy)', good: 200, poor: 600, delta: 50, unit: 'ms' },
  inp: { label: 'INP', good: 200, poor: 500, delta: 25, unit: 'ms' },
  fcp: { label: 'FCP', good: 1800, poor: 3000, delta: 100, unit: 'ms' },
  ttfb: { label: 'TTFB', good: 800, poor: 1800, delta: 100, unit: 'ms' },
  si: { label: 'Speed Index', good: 3400, poor: 5800, delta: 200, unit: 'ms' },
};
export const DEFAULT_GATED = ['lcp', 'cls', 'tbt', 'inp'];
const LH_AUDITS = { lcp: 'largest-contentful-paint', cls: 'cumulative-layout-shift', tbt: 'total-blocking-time', fcp: 'first-contentful-paint', ttfb: 'server-response-time', si: 'speed-index', inp: 'interaction-to-next-paint' };
const WV = { LCP: 'lcp', CLS: 'cls', INP: 'inp', FCP: 'fcp', TTFB: 'ttfb', TBT: 'tbt' };
const fmt = (k, v) => (v == null ? '–' : k === 'cls' ? v.toFixed(3) : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

/** Extract runs [{ url, metrics, score?, error?, source }] from any supported JSON document. */
export function extractRuns(doc, source = '') {
  if (Array.isArray(doc)) {
    if (doc.every((x) => x && typeof x === 'object' && 'name' in x && 'value' in x)) return webVitals(doc, source);
    return doc.flatMap((d) => extractRuns(d, source));
  }
  if (!doc || typeof doc !== 'object') return [];
  if (doc.lighthouseResult) { const r = lhr(doc.lighthouseResult, source); const le = doc.loadingExperience?.metrics; if (le) { const p = (k) => le[k]?.percentile; const f = { lcp: p('LARGEST_CONTENTFUL_PAINT_MS'), inp: p('INTERACTION_TO_NEXT_PAINT'), cls: p('CUMULATIVE_LAYOUT_SHIFT_SCORE') != null ? p('CUMULATIVE_LAYOUT_SHIFT_SCORE') / 100 : undefined, ttfb: p('EXPERIMENTAL_TIME_TO_FIRST_BYTE'), fcp: p('FIRST_CONTENTFUL_PAINT_MS') }; r.field = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)); } return [r]; }
  if (doc.audits && (doc.lighthouseVersion || doc.finalUrl || doc.requestedUrl || doc.finalDisplayedUrl)) return [lhr(doc, source)];
  if (doc.name && 'value' in doc) return webVitals([doc], source);
  if (Array.isArray(doc.runs)) return doc.runs.map((r) => ({ url: r.url, metrics: pick(r.metrics || r), score: r.score, source }));
  return [];
}
function pick(o) { const m = {}; for (const k of Object.keys(METRICS)) if (typeof o?.[k] === 'number') m[k] = o[k]; return m; }
function lhr(r, source) {
  const url = r.finalDisplayedUrl || r.finalUrl || r.requestedUrl || r.mainDocumentUrl || source;
  if (r.runtimeError?.code && r.runtimeError.code !== 'NO_ERROR') return { url, metrics: {}, error: `${r.runtimeError.code}: ${r.runtimeError.message || ''}`.trim(), source };
  const metrics = {}; for (const [k, a] of Object.entries(LH_AUDITS)) { const v = r.audits?.[a]?.numericValue; if (typeof v === 'number') metrics[k] = v; }
  const score = r.categories?.performance?.score;
  return { url, metrics, score: typeof score === 'number' ? score : undefined, source };
}
function webVitals(list, source) {
  const byUrl = new Map();
  for (const e of list) { const k = WV[String(e.name).toUpperCase()]; if (!k || typeof e.value !== 'number') continue; const url = e.url || e.page || e.pathname || source; const arr = (byUrl.get(url) || byUrl.set(url, {}).get(url)); (arr[k] ||= []).push(e.value); }
  return [...byUrl].map(([url, m]) => ({ url, metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, percentile(v, 75)])), source, rum: true }));
}
export function percentile(arr, p) { const s = [...arr].sort((a, b) => a - b); if (!s.length) return undefined; const i = (p / 100) * (s.length - 1); const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); }
const median = (a) => percentile(a, 50);
const normUrl = (u) => String(u || '').replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';

/** Group runs by URL and take the median of each metric (like Lighthouse CI). */
export function summarise(runs) {
  const by = new Map();
  for (const r of runs) { const k = normUrl(r.url); (by.get(k) || by.set(k, []).get(k)).push(r); }
  return [...by].map(([url, rs]) => {
    const ok = rs.filter((r) => !r.error); const metrics = {}; const spread = {};
    for (const k of Object.keys(METRICS)) { const v = ok.map((r) => r.metrics[k]).filter((x) => typeof x === 'number'); if (v.length) { metrics[k] = median(v); if (v.length >= 3 && metrics[k] > 0 && Math.max(...v) - Math.min(...v) > METRICS[k].delta) spread[k] = (Math.max(...v) - Math.min(...v)) / metrics[k]; } }
    const field = ok.find((r) => r.field)?.field; const scores = ok.map((r) => r.score).filter((x) => typeof x === 'number');
    return { url: rs[0].url || url, rum: rs.every((r) => r.rum), runs: rs.length, failed: rs.length - ok.length, errors: rs.filter((r) => r.error).map((r) => r.error), metrics, field, score: scores.length ? median(scores) : undefined, spread, sources: rs.map((r) => r.source) };
  });
}

export function evaluate(pages, opts = {}) {
  const raw = []; const add = (rule, subject, message, fix, file) => raw.push({ rule, severity: RULES[rule].severity, subject, message, fix, file });
  const gated = opts.metrics?.length ? opts.metrics : DEFAULT_GATED; const th = opts.thresholds || {};
  const maxReg = opts.maxRegression ?? 10; const base = new Map((opts.baseline?.pages || []).map((p) => [normUrl(p.url), p]));
  const FIX = { lcp: 'Preload or prioritise the LCP image (fetchpriority="high"), avoid lazy-loading it, reduce render-blocking CSS/JS and server time.', cls: 'Give images, ads and embeds width/height or aspect-ratio; avoid inserting content above existing content; use font-display: optional or size-adjusted fallbacks.', tbt: 'Break up long tasks, defer non-critical JS and third-party scripts, ship less JavaScript.', inp: 'Break up long tasks in event handlers and yield to the main thread.', fcp: 'Remove render-blocking resources and reduce server response time.', ttfb: 'Cache HTML at the edge, reduce server work and redirects.', si: 'Prioritise above-the-fold content and reduce render-blocking resources.' };
  for (const p of pages) {
    const file = p.sources[0];
    for (const e of p.errors) add('vitals-report-error', p.url, `${p.url}: ${e}`, 'Check the page loads in Chrome headless and re-run.', file);
    if (!p.runs || p.failed === p.runs) continue;
    for (const k of gated) {
      const M = METRICS[k]; if (!M) continue; const v = p.metrics[k] ?? (k === 'inp' ? p.field?.inp : undefined);
      if (v == null) { const labOnly = k === 'tbt' || k === 'si'; if (opts.metrics?.includes(k) || (k !== 'inp' && !(labOnly && p.rum))) add('vitals-metric-missing', `${p.url}#${k}`, `${p.url}: no ${M.label} in the report`, 'Use a report that includes this metric, or remove it from --metrics.', file); continue; }
      const good = th[k]?.good ?? th[k] ?? M.good; const poor = th[k]?.poor ?? Math.max(M.poor, good);
      if (v > poor) add('vitals-poor', `${p.url}#${k}`, `${p.url}: ${M.label} ${fmt(k, v)} is poor (> ${fmt(k, poor)})`, FIX[k], file);
      else if (v > good) add('vitals-needs-improvement', `${p.url}#${k}`, `${p.url}: ${M.label} ${fmt(k, v)} needs improvement (> ${fmt(k, good)})`, FIX[k], file);
      const b = base.get(normUrl(p.url))?.metrics?.[k];
      if (typeof b === 'number') { const d = v - b; const pct = b > 0 ? (d / b) * 100 : (d > 0 ? Infinity : 0); if (d > (opts.minDelta?.[k] ?? M.delta) && pct > maxReg) add('vitals-regression', `${p.url}#${k}`, `${p.url}: ${M.label} regressed ${fmt(k, b)} → ${fmt(k, v)} (+${Number.isFinite(pct) ? pct.toFixed(0) : '∞'}%)`, 'Compare the two Lighthouse reports (treemap, long tasks, LCP element) to find the change.', file); }
      if ((p.spread[k] ?? 0) > (opts.maxSpread ?? 0.25)) add('vitals-variance', `${p.url}#${k}`, `${p.url}: ${M.label} varies ${(p.spread[k] * 100).toFixed(0)}% across ${p.runs} runs`, 'Run more times or on a quieter machine; vitals-pulse uses the median.', file);
    }
    if (opts.minScore != null && typeof p.score === 'number' && p.score < opts.minScore) add('vitals-score-low', p.url, `${p.url}: performance score ${Math.round(p.score * 100)} < ${Math.round(opts.minScore * 100)}`, 'See the failing Lighthouse opportunities.', file);
  }
  return raw;
}

function collect(paths) {
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.git') continue; const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(json|jsonl|ndjson)$/i.test(e.name) && !/^(package(-lock)?|tsconfig|\.vitals-pulse)\.json$|^(assertion-results|manifest|links)\.json$/i.test(e.name)) files.push(p); } };
  for (const p of paths) { if (!existsSync(p)) throw new UsageError(`No such file or directory: ${p}`); if (statSync(p).isDirectory()) walk(p); else files.push(p); }
  return files.sort();
}
export function loadRuns(paths) {
  const runs = []; const errors = [];
  for (const f of collect(paths)) {
    const rel = relative(process.cwd(), f).split(sep).join('/') || f; const text = readFileSync(f, 'utf8');
    try { const docs = /\.(jsonl|ndjson)$/i.test(f) ? [text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))] : [JSON.parse(text)]; for (const d of docs) runs.push(...extractRuns(d, rel)); }
    catch (e) { errors.push({ file: rel, message: e.message }); }
  }
  return { runs, errors };
}
/** Optional: run the Lighthouse CLI (must be installed) for each URL, n times. Returns runs. */
export function runLighthouse(urls, { runs = 3, cmd = 'lighthouse', preset = 'desktop', flags = [] } = {}) {
  const out = [];
  for (const url of urls) for (let i = 0; i < runs; i++) {
    const r = spawnSync(cmd, [url, '--output=json', '--quiet', '--only-categories=performance', `--chrome-flags=--headless=new --no-sandbox`, ...(preset === 'desktop' ? ['--preset=desktop'] : []), ...flags], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) { out.push({ url, metrics: {}, error: r.error?.code === 'ENOENT' ? `${cmd} not found (npm i -g lighthouse)` : `lighthouse exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop()}`, source: url }); continue; }
    try { out.push(...extractRuns(JSON.parse(r.stdout), url)); } catch (e) { out.push({ url, metrics: {}, error: e.message, source: url }); }
  }
  return out;
}
export function snapshot(pages) { return { schema: 'vitals-pulse/1', generatedAt: new Date().toISOString(), pages: pages.map(({ url, metrics, score, runs }) => ({ url, metrics, score, runs })) }; }

export function check(paths = [], opts = {}, config = {}, configFile) {
  const tool = { name: 'vitals-pulse', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '⚡', defaultFile: 'lighthouse.json' };
  const urls = [...(config.urls || []), ...(opts.urls || [])];
  let runs = []; const errs = [];
  if (urls.length) runs.push(...(opts.runner || runLighthouse)(urls, { runs: opts.runs ?? config.runs ?? 3, cmd: opts.lighthouseCmd ?? config.lighthouseCmd, preset: opts.preset ?? config.preset ?? 'desktop' }));
  if (paths.length || !urls.length) { const l = loadRuns(paths.length ? paths : [existsSync('.lighthouseci') ? '.lighthouseci' : '.']); runs.push(...l.runs); errs.push(...l.errors); }
  let baseline = null; const bf = opts.baseline ?? config.baseline;
  if (bf) { if (!existsSync(bf)) { if (!opts.baselineOptional) throw new UsageError(`Baseline not found: ${bf}`); } else try { baseline = JSON.parse(readFileSync(bf, 'utf8')); } catch (e) { throw new UsageError(`Invalid baseline ${bf}: ${e.message}`); } }
  const pages = summarise(runs);
  const th = { ...(config.thresholds || {}), ...(opts.thresholds || {}) };
  const raw = errs.map((e) => ({ rule: 'vitals-report-error', severity: 'high', subject: e.file, file: e.file, message: `${e.file}: ${e.message}`, fix: 'Pass Lighthouse/PSI JSON or web-vitals JSON lines.' }));
  if (!pages.length && !errs.length) raw.push({ rule: 'vitals-no-reports', severity: 'high', subject: 'reports', message: 'No Lighthouse, PageSpeed Insights or web-vitals reports found', fix: 'Pass report files or directories (e.g. .lighthouseci), or --url with Lighthouse installed.' });
  raw.push(...evaluate(pages, { metrics: opts.metrics?.length ? opts.metrics : config.metrics, thresholds: th, maxRegression: opts.maxRegression ?? config.maxRegression, minScore: opts.minScore ?? config.minScore, maxSpread: config.maxSpread, minDelta: config.minDelta, baseline }));
  if (opts.snapshot) writeFileSync(opts.snapshot, JSON.stringify(snapshot(pages), null, 2) + '\n');
  const med = (k) => { const v = pages.map((p) => p.metrics[k]).filter((x) => x != null); return v.length ? fmt(k, Math.max(...v)) : '–'; };
  return buildReport(tool, paths.join(', ') || urls.join(', ') || '.', raw, config, { now: opts.now, configFile, summaryLine: `${pages.length} URL(s), ${runs.length} run(s); worst LCP ${med('lcp')}, CLS ${med('cls')}, TBT ${med('tbt')}${baseline ? '; compared with baseline' : ''}`, info: { pages: pages.map(({ url, runs: n, metrics, score, field }) => ({ url, runs: n, metrics, score, field })) } });
}
