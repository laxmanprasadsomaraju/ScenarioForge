import type { AnalysisEngine } from './analyzeChange';

/**
 * Placeholder until the shared/analysis engine (Lane C) is wired in at
 * integration. It recognises no subjects, so Confluence is never called, and
 * reports `not-assessed` with an explicit reason instead of guessing.
 */
export const pendingEngine: AnalysisEngine = {
  extractChangeSubjects: () => [],
  searchTermsForSubjects: () => [],
  analyzeChange: (change, _runbooks, analyzedAt) => ({
    changeKey: change.key,
    analyzedAt,
    status: 'not-assessed',
    notAssessedReason: 'Change analysis is not available in this build yet.',
    subjects: [],
    findings: [],
    coverage: { pagesFound: 0, pagesRead: 0, pagesWithoutSteps: 0, pagesSkipped: 0 },
  }),
};
