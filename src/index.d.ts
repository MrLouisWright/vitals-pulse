export * from './core.js';
import type { Report, Finding } from './core.js';
export type Metric = 'lcp' | 'cls' | 'tbt' | 'inp' | 'fcp' | 'ttfb' | 'si';
export declare const RULES: Record<string, { severity: string; title: string }>;
export declare const METRICS: Record<Metric, { label: string; good: number; poor: number; delta: number; unit: string }>;
export declare const DEFAULT_GATED: Metric[];
export interface Run { url: string; metrics: Partial<Record<Metric, number>>; score?: number; error?: string; source: string; field?: Partial<Record<Metric, number>>; rum?: boolean }
export interface PageSummary { url: string; runs: number; failed: number; errors: string[]; metrics: Partial<Record<Metric, number>>; score?: number; field?: Partial<Record<Metric, number>>; spread: Partial<Record<Metric, number>>; sources: string[] }
export declare function extractRuns(doc: unknown, source?: string): Run[];
export declare function percentile(values: number[], p: number): number | undefined;
export declare function summarise(runs: Run[]): PageSummary[];
export declare function evaluate(pages: PageSummary[], opts?: { metrics?: Metric[]; thresholds?: Partial<Record<Metric, number | { good?: number; poor?: number }>>; maxRegression?: number; minScore?: number; maxSpread?: number; baseline?: { pages: Array<{ url: string; metrics: Partial<Record<Metric, number>> }> } }): Finding[];
export declare function loadRuns(paths: string[]): { runs: Run[]; errors: Array<{ file: string; message: string }> };
export declare function runLighthouse(urls: string[], opts?: { runs?: number; cmd?: string; preset?: 'desktop' | 'mobile'; flags?: string[] }): Run[];
export declare function snapshot(pages: PageSummary[]): { schema: string; generatedAt: string; pages: Array<Pick<PageSummary, 'url' | 'metrics' | 'score' | 'runs'>> };
export declare function check(paths?: string[], opts?: Record<string, unknown>, config?: Record<string, unknown>, configFile?: string): Report;
