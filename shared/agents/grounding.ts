/**
 * Grounding and prompt-injection guards for Rovo action outputs (M6).
 * Pure: no Forge imports, no clock, no model. Design: docs/M6_PLAN.md §4.
 *
 * Two jobs:
 * 1. `detectSourceInstructions` flags Jira or Confluence text that reads as
 *    if it were addressed to an AI assistant ("ignore previous instructions",
 *    tool-call markup, hidden comments, invisible characters). A flag never
 *    hides, rewrites or drops the text: it is still returned verbatim as
 *    quoted data, and the warning lets the agent (and people) say so. Nothing
 *    here executes or follows source text.
 * 2. `checkGrounding` checks an answer's citations against an action output:
 *    every claim must cite at least one evidence id, and every cited id must
 *    be one the output actually returned.
 *
 * Patterns cannot catch every injection. The real defences are structural
 * (source text only inside data fields, GET-only actions, fixed verdicts);
 * these flags are an aid, not a filter.
 */

/** Names reported in `sourceWarnings[].pattern`. Stable: prompts and tests use them. */
export type SourceGuardPattern =
  | 'ignore-instructions'
  | 'role-reassignment'
  | 'system-prompt'
  | 'as-an-ai'
  | 'addressed-to-assistant'
  | 'conceal-from-user'
  | 'verdict-override'
  | 'write-request'
  | 'tool-call-request'
  | 'tool-call-markup'
  | 'hidden-html-comment'
  | 'zero-width-characters'
  | 'bidi-control-characters'
  | 'unicode-tag-characters';

interface TextRule {
  name: SourceGuardPattern;
  regex: RegExp;
}

/** Characters that render as nothing but can hide or split words. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u180E\u00AD]/u;
/** Bidirectional overrides and isolates that can reorder displayed text. */
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
/** Unicode tag block, used to smuggle invisible ASCII. */
const UNICODE_TAGS = /[\u{E0000}-\u{E007F}]/u;
const INVISIBLE_ALL =
  /[\u200B-\u200D\u2060\uFEFF\u180E\u00AD\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u{E0000}-\u{E007F}]/gu;

/**
 * Matched against a normalised copy (NFKC, invisible characters removed,
 * spaces collapsed, line breaks kept) so "ig\u200Bnore previous instructions" still matches.
 * Case-insensitive throughout.
 */
const TEXT_RULES: readonly TextRule[] = [
  {
    name: 'ignore-instructions',
    regex:
      /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|of|these|those)\s+)*(?:previous|prior|above|earlier|preceding|existing|system|original)?\s*(?:instructions?|prompts?|rules|directives|guidelines|guardrails)\b/i,
  },
  {
    name: 'role-reassignment',
    regex:
      /\byou\s+are\s+now\b|\byou\s+are\s+(?:an?|the|my)\s+(?:\w+\s+)?(?:ai|assistant|agent|chatbot|llm|language\s+model|bot)\b|\b(?:act|behave|respond)\s+as\s+(?:an?|the)\s+(?:\w+\s+)?(?:ai|assistant|chatbot|llm)\b|\bnew\s+(?:instructions|persona|role)\s*:/i,
  },
  {
    name: 'system-prompt',
    regex: /\bsystem\s+prompt\b|\b(?:system|developer)\s+(?:message|instructions?)\b/i,
  },
  { name: 'as-an-ai', regex: /\bas\s+an?\s+(?:ai|assistant|language\s+model|llm)\b/i },
  {
    name: 'addressed-to-assistant',
    regex:
      /\b(?:dear|hey|hi|hello|attention|note\s+to(?:\s+the)?|instructions?\s+for(?:\s+the)?|to\s+the)\s+(?:ai|assistant|agent|rovo|chatbot|llm|bot|language\s+model)\b|\b(?:ai|assistants?|llms?|rovo)\s+(?:must|should|shall)\b/i,
  },
  {
    name: 'conceal-from-user',
    regex:
      /\b(?:do\s+not|don't|never)\s+(?:tell|inform|show|reveal|mention)\b[^.!?\n]{0,40}\b(?:user|human|reader|anyone)\b/i,
  },
  {
    name: 'verdict-override',
    regex:
      /\b(?:mark|report|declare)\s+(?:this|it|that|the\s+\w+|everything)\s+as\s+(?:safe|ready|resolved|passed|verified)\b/i,
  },
  {
    name: 'write-request',
    regex: /\bcreate\s+(?:a|an)\s+(?:new\s+)?(?:jira\s+)?(?:issue|ticket|work\s+item)\b/i,
  },
  {
    name: 'tool-call-request',
    regex: /\b(?:call|invoke)\s+(?:the\s+)?[\w-]+\s+(?:action|tool|function)\b/i,
  },
  {
    name: 'tool-call-markup',
    regex:
      /<\/?\s*(?:tool_call|tool_use|tool_result|function_call|function_calls|invoke|antml:[\w-]+|system|assistant|instructions?)\b[^>]*>|<\|\s*(?:im_start|im_end|system|assistant|user|endoftext)\s*\|>|\[\/?(?:INST|SYS|SYSTEM)\]|"(?:tool|function|tool_name|function_name|name)"\s*:\s*"[\w.-]+"\s*,\s*"(?:arguments|parameters|input|args)"\s*:|^\s*(?:system|assistant)\s*:/im,
  },
];

const HTML_COMMENT = /<!--[\s\S]*?-->/;

/** Copy used only for matching; the returned excerpt is never changed. */
export function normaliseForScan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE_ALL, '')
    .replace(/[^\S\n]+/g, ' ');
}

/**
 * Pattern names that match `text`, in rule order, without duplicates. Raw
 * checks (invisible characters, HTML comments) run on the original text;
 * phrase checks run on the normalised copy and on the text inside any HTML
 * comment.
 */
export function scanSourceText(text: string | null | undefined): SourceGuardPattern[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const found: SourceGuardPattern[] = [];
  const normalised = normaliseForScan(text);
  for (const rule of TEXT_RULES) {
    if (rule.regex.test(normalised)) found.push(rule.name);
  }
  if (HTML_COMMENT.test(text)) found.push('hidden-html-comment');
  if (ZERO_WIDTH.test(text)) found.push('zero-width-characters');
  if (BIDI_CONTROL.test(text)) found.push('bidi-control-characters');
  if (UNICODE_TAGS.test(text)) found.push('unicode-tag-characters');
  return found;
}

/** One piece of source text and the id the agent would cite for it. */
export interface ScannedSource {
  evidenceId: string;
  texts: (string | null | undefined)[];
}

export interface SourceWarning {
  evidenceId: string;
  pattern: SourceGuardPattern;
}

/**
 * Flags for every source, one entry per (evidenceId, pattern), in input order.
 * The caller returns the text unchanged alongside these warnings.
 */
export function detectSourceInstructions(sources: readonly ScannedSource[]): SourceWarning[] {
  const seen = new Set<string>();
  const warnings: SourceWarning[] = [];
  for (const source of sources) {
    for (const text of source.texts) {
      for (const pattern of scanSourceText(text)) {
        const key = `${source.evidenceId}\u0000${pattern}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push({ evidenceId: source.evidenceId, pattern });
      }
    }
  }
  return warnings;
}

// Grounding ------------------------------------------------------------------

/**
 * Every evidence id an action output returned: the `id` of each object inside
 * any `evidence` array, at any depth. Ids mentioned elsewhere (for example
 * `trail[].evidenceIds`) are references, not evidence, and are not collected.
 * A failure result (`ok: false`) has none.
 */
export function collectEvidenceIds(output: unknown): Set<string> {
  const ids = new Set<string>();
  if (isRecord(output) && output.ok === false) return ids;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence' && Array.isArray(child)) {
        for (const item of child) {
          if (isRecord(item) && typeof item.id === 'string' && item.id.length > 0) ids.add(item.id);
        }
      }
      visit(child, depth + 1);
    }
  };
  visit(output, 0);
  return ids;
}

/** One factual claim in an agent answer and the evidence ids it cites. */
export interface CitedClaim {
  claim: string;
  evidenceIds: string[];
}

export type GroundingProblem =
  | { kind: 'uncited'; claimIndex: number }
  | { kind: 'unknown-evidence'; claimIndex: number; evidenceId: string }
  | { kind: 'no-evidence-returned'; claimIndex: number };

export type GroundingResult = { ok: true } | { ok: false; problems: GroundingProblem[] };

/**
 * Checks an answer against the action output it was built from. A claim must
 * cite at least one id, and every id must be one the output returned. When the
 * action failed or returned no evidence, any claim is ungrounded: the agent
 * should repeat the failure or verdict, not add claims.
 */
export function checkGrounding(
  answerCitations: readonly CitedClaim[],
  actionOutput: unknown,
): GroundingResult {
  const known = collectEvidenceIds(actionOutput);
  const problems: GroundingProblem[] = [];
  answerCitations.forEach((citation, claimIndex) => {
    const ids = Array.isArray(citation.evidenceIds) ? citation.evidenceIds : [];
    if (known.size === 0) {
      problems.push({ kind: 'no-evidence-returned', claimIndex });
      return;
    }
    if (ids.length === 0) {
      problems.push({ kind: 'uncited', claimIndex });
      return;
    }
    for (const evidenceId of ids) {
      if (typeof evidenceId !== 'string' || !known.has(evidenceId)) {
        problems.push({ kind: 'unknown-evidence', claimIndex, evidenceId: String(evidenceId) });
      }
    }
  });
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
