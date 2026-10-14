import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, extractRuns, summarise, evaluate, percentile, runCli, RULES } from '../src/index.js';

const ids = (r) => [...new Set(r.findings.map((f) => f.rule))].sort();
const io = () => { const o = { s: '', e: '' }; return { o, io: { stdout: { write: (x) => { o.s += x; } }, stderr: { write: (x) => { o.e += x; } } } }; };
const tmp = () => mkdtempSync(join(tmpdir(), 'vp-'));
const lhr = (url, [lcp, cls, tbt], score = 0.95) => ({ lighthouseVersion: '12', finalDisplayedUrl: url, categories: { performance: { score } }, audits: { 'largest-contentful-paint': { numericValue: lcp }, 'cumulative-layout-shift': { numericValue: cls }, 'total-blocking-time': { numericValue: tbt } } });

test('percentile', () => { assert.equal(percentile([1, 2, 3, 4], 50), 2.5); assert.equal(percentile([5], 75), 5); assert.equal(percentile([], 50), undefined); });
test('extractRuns: Lighthouse, PSI, web-vitals, LHCI arrays', () => {
  assert.deepEqual(extractRuns(lhr('https://a.io/', [1000, 0.01, 50]))[0].metrics, { lcp: 1000, cls: 0.01, tbt: 50 });
  const psi = extractRuns({ lighthouseResult: lhr('https://a.io/', [1000, 0, 0]), loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 7 } } } })[0];
  assert.deepEqual(psi.field, { inp: 180, cls: 0.07 });
  const wv = extractRuns([{ name: 'LCP', value: 1000, url: '/x' }, { name: 'LCP', value: 3000, url: '/x' }, { name: 'CLS', value: 0.2, url: '/y' }]);
  assert.equal(wv.find((r) => r.url === '/x').metrics.lcp, 2500); assert.ok(wv[0].rum);
  assert.equal(extractRuns([lhr('a', [1, 0, 0]), lhr('b', [1, 0, 0])]).length, 2);
  assert.match(extractRuns({ lighthouseVersion: '12', requestedUrl: 'u', runtimeError: { code: 'NO_FCP', message: 'x' }, audits: {} })[0].error, /NO_FCP/);
  assert.deepEqual(extractRuns({ foo: 1 }), []);
});
test('summarise takes the median per URL and ignores failed runs', () => {
  const p = summarise([...[1000, 3000, 2000].map((l) => extractRuns(lhr('https://a.io/', [l, 0, 0]))[0]), { url: 'https://a.io', metrics: {}, error: 'x' }]);
  assert.equal(p.length, 1); assert.equal(p[0].metrics.lcp, 2000); assert.equal(p[0].runs, 4); assert.equal(p[0].failed, 1);
});
test('thresholds: good, needs improvement, poor, overrides', () => {
  const pages = summarise(extractRuns([lhr('a', [2600, 0.3, 100])]));
  assert.deepEqual(evaluate(pages).map((f) => `${f.rule}:${f.subject}`), ['vitals-needs-improvement:a#lcp', 'vitals-poor:a#cls']);
  assert.deepEqual(evaluate(pages, { thresholds: { lcp: 3000 }, metrics: ['lcp'] }), []);
});
test('regression vs baseline needs both percent and absolute delta', () => {
  const pages = summarise(extractRuns([lhr('https://a.io/', [2000, 0.05, 100])]));
  assert.deepEqual(evaluate(pages, { baseline: { pages: [{ url: 'https://a.io', metrics: { lcp: 1500, cls: 0.049, tbt: 100 } }] } }).map((f) => f.subject), ['https://a.io/#lcp']);
  assert.deepEqual(evaluate(pages, { maxRegression: 50, baseline: { pages: [{ url: 'https://a.io/', metrics: { lcp: 1500 } }] } }), []);
});
test('good fixture is clean (even at info)', () => assert.deepEqual(ids(check(['test/fixtures/good'])), []));
test('bad fixture', () => assert.deepEqual(ids(check(['test/fixtures/bad'], { minScore: 0.9 })), ['vitals-needs-improvement', 'vitals-poor', 'vitals-report-error', 'vitals-score-low']));
test('snapshot round trip gives regressions', () => {
  const d = tmp(); const s = join(d, 'base.json'); check(['test/fixtures/good'], { snapshot: s });
  assert.equal(JSON.parse(readFileSync(s, 'utf8')).pages.length, 2);
  writeFileSync(join(d, 'now.json'), JSON.stringify(lhr('https://example.com/', [2450, 0.02, 100])));
  assert.deepEqual(ids(check([join(d, 'now.json')], { baseline: s })), ['vitals-regression']);
});
test('no reports and missing metric', () => {
  const d = tmp(); writeFileSync(join(d, 'x.json'), '{}'); assert.deepEqual(ids(check([d])), ['vitals-no-reports']);
  writeFileSync(join(d, 'x.json'), JSON.stringify({ lighthouseVersion: '12', finalUrl: 'u', audits: { 'largest-contentful-paint': { numericValue: 1 } } }));
  assert.deepEqual(ids(check([d])), ['vitals-metric-missing']);
});
test('runner hook for --url (Lighthouse not required in tests)', () => {
  const r = check([], { urls: ['https://a.io/'], runs: 2, runner: (urls, o) => urls.flatMap((u) => Array.from({ length: o.runs }, () => extractRuns(lhr(u, [5000, 0, 0]))[0])) });
  assert.deepEqual(ids(r), ['vitals-poor']); assert.equal(r.info.pages[0].runs, 2);
});
test('missing baseline is a usage error unless optional', () => { assert.throws(() => check(['test/fixtures/good'], { baseline: '/nope.json' })); assert.doesNotThrow(() => check(['test/fixtures/good'], { baseline: '/nope.json', baselineOptional: true })); });
test('CLI exit codes and SARIF', async () => {
  const cli = { name: 'vitals-pulse', version: '1.0.0', configKey: 'vitalsPulse', rules: RULES, tagline: 't', usage: 'u', help: '', options: {}, dirFrom: () => '.', run: async ({ positionals }) => check(positionals) };
  let t = io(); assert.equal(await runCli(cli, ['test/fixtures/good', '--fail-on', 'low'], t.io), 0);
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/bad', '-f', 'sarif'], t.io), 1); assert.equal(JSON.parse(t.o.s).version, '2.1.0');
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/none'], t.io), 2);
});
