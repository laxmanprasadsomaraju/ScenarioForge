import { describe, expect, it } from 'vitest';
import { analyzeChange } from '../shared/analysis/engine';
import { CASES } from './fixtures/analysis/cases';

/**
 * Precision and recall of the change-to-recovery engine over the labelled,
 * synthetic fixture set. A finding counts as correct when page, step and term
 * match a label; confidence agreement is reported separately.
 */

const ANALYZED_AT = '2026-11-10T12:00:00.000Z';

interface Row {
  id: string;
  category: string;
  tp: number;
  fp: number;
  fn: number;
  statusOk: boolean;
  confidenceOk: boolean;
}

function evaluate(): Row[] {
  return CASES.map((testCase) => {
    const result = analyzeChange(testCase.change, testCase.runbooks, ANALYZED_AT);
    const key = (f: { pageId: string; stepOrder: number; term: string }): string =>
      `${f.pageId}:${f.stepOrder}:${f.term}`;
    const expected = new Map(testCase.expected.findings.map((f) => [key(f), f.confidence]));
    const actual = new Map(
      result.findings.map((f) => [key({ ...f, term: f.subject.term }), f.confidence]),
    );
    let tp = 0;
    let confidenceOk = true;
    for (const [k, confidence] of actual) {
      if (expected.has(k)) {
        tp += 1;
        if (expected.get(k) !== confidence) confidenceOk = false;
      }
    }
    return {
      id: testCase.id,
      category: testCase.category,
      tp,
      fp: actual.size - tp,
      fn: expected.size - tp,
      statusOk: result.status === testCase.expected.status,
      confidenceOk,
    };
  });
}

describe('labelled evaluation (synthetic fixtures)', () => {
  const rows = evaluate();
  const tp = rows.reduce((n, r) => n + r.tp, 0);
  const fp = rows.reduce((n, r) => n + r.fp, 0);
  const fn = rows.reduce((n, r) => n + r.fn, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);

  it('prints the evaluation table', () => {
    const lines = [
      'case                              category         TP FP FN status conf',
      ...rows.map(
        (r) =>
          `${r.id.padEnd(34)}${r.category.padEnd(17)}${String(r.tp).padStart(2)} ${String(r.fp).padStart(2)} ${String(r.fn).padStart(2)} ${r.statusOk ? 'ok    ' : 'MISS  '}${r.confidenceOk ? 'ok' : 'MISS'}`,
      ),
      `cases=${rows.length} TP=${tp} FP=${fp} FN=${fn} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}`,
    ];
    console.log(lines.join('\n'));
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it('has precision 1.0 on the fixtures', () => {
    expect(fp).toBe(0);
    expect(precision).toBe(1);
  });

  it('has recall of at least 0.9 on the fixtures', () => {
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it('assigns the labelled confidence to every correct finding', () => {
    expect(rows.filter((r) => !r.confidenceOk).map((r) => r.id)).toEqual([]);
  });

  it('reports the labelled status for every case except accepted misses', () => {
    const wrong = rows.filter((r) => !r.statusOk && r.category !== 'accepted-miss');
    expect(wrong.map((r) => r.id)).toEqual([]);
  });

  it('only misses the documented accepted-miss cases', () => {
    const missed = rows.filter((r) => r.fn > 0).map((r) => r.category);
    expect(missed.every((c) => c === 'accepted-miss')).toBe(true);
  });

  it('labels subjects as expected where a case labels them', () => {
    const mismatches = CASES.filter(
      (c) => c.expected.subjects && c.category !== 'accepted-miss',
    ).filter((c) => {
      const terms = analyzeChange(c.change, c.runbooks, ANALYZED_AT).subjects.map((s) => s.term);
      return JSON.stringify(terms) !== JSON.stringify(c.expected.subjects);
    });
    expect(mismatches.map((c) => c.id)).toEqual([]);
  });
});
