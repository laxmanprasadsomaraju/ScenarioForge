import {
  analyzeChange,
  extractChangeSubjects,
  searchTermsForSubjects,
} from '../../shared/analysis';
import type { AnalysisEngine } from './analyzeChange';

/** The deterministic, AI-free engine from shared/analysis (D5, D6). */
export const ruleEngine: AnalysisEngine = {
  extractChangeSubjects,
  searchTermsForSubjects,
  analyzeChange,
};
