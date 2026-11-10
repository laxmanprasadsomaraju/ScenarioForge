import type { ChangeAction, ChangeEvidence, ChangeSubject } from './types';
import type { Sentence, Token } from './text';
import { mentionsTerm, normaliseTerm, splitSentences, tokenize } from './text';

/**
 * Rule-based recognition of what a change retires, replaces, migrates,
 * renames, disables or upgrades.
 *
 * Pure and deterministic: no clock reads, randomness or AI. Precision is
 * preferred over recall: a subject is only taken from a distinctive token
 * (CamelCase, backticked, hostname, identifier with digits, dashes or
 * underscores, acronym) or a capitalised name that is not a generic word.
 *
 * Rules, in order:
 * 1. Sentences come from the description first, then the summary, so the
 *    quoted excerpt is the most explicit statement; the excerpt is always the
 *    sentence verbatim.
 * 2. An action verb starts a clause; its object runs to the next clause
 *    boundary (punctuation or a word such as "to", "with", "on", "in").
 *    "replace X with Y", "swap X for Y", "migrate X to Y", "move from X to Y",
 *    "rename X to Y", "Y replaces X" and "X in favour of Y" name a replacement.
 * 3. Passive or headline forms ("X will be retired", "X retired") take the
 *    subject from before the verb when nothing follows it.
 * 4. Negated verbs ("will not retire", "no longer retire") and cancellation
 *    wording ("cancelled", "called off", "was rolled back") cancel the terms of
 *    that sentence for the whole change. Cancellation wording without a named
 *    term, or a cancelled Jira status, cancels the whole change.
 * 5. Historical background is skipped: a past-tense verb in a sentence with a
 *    past marker ("in 2023" before the change's year, "previously",
 *    "already", "years ago") or a "Background:"/"History:" prefix is not the
 *    change's own action.
 * 6. Partial-scope wording ("50%", "some of", "pilot", "stays for EU") in any
 *    sentence naming the term marks the subject as partial.
 */

type ClauseKind = 'object' | 'replace' | 'migrate' | 'rename';

interface VerbRule {
  action: ChangeAction;
  kind: ClauseKind;
  pattern: RegExp;
}

function verbPattern(source: string): RegExp {
  return new RegExp(`\\b(?:${source})\\b`, 'gi');
}

const VERB_RULES: VerbRule[] = [
  {
    action: 'retire',
    kind: 'object',
    pattern: verbPattern(
      [
        String.raw`retirement\s+of`,
        String.raw`retir(?:e|es|ed|ing)`,
        String.raw`decommissioning\s+of`,
        String.raw`decommission(?:s|ed|ing)?`,
        String.raw`sunsetting\s+of`,
        String.raw`sunset(?:s|ting)?`,
        String.raw`removal\s+of`,
        String.raw`remov(?:e|es|ed|ing)`,
        String.raw`shutdown\s+of`,
        String.raw`shut(?:s|ting)?\s+down`,
        String.raw`deprecation\s+of`,
        String.raw`deprecat(?:e|es|ed|ing)`,
        String.raw`tear(?:s|ing)?\s+down`,
        String.raw`t[oa]rn?\s+down`,
        String.raw`delet(?:e|es|ed|ing)`,
      ].join('|'),
    ),
  },
  {
    action: 'disable',
    kind: 'object',
    pattern: verbPattern(
      String.raw`disabl(?:e|es|ed|ing)|turn(?:s|ed|ing)?\s+off|switch(?:es|ed|ing)?\s+off`,
    ),
  },
  {
    action: 'replace',
    kind: 'replace',
    pattern: verbPattern(
      String.raw`replacement\s+of|replac(?:e|es|ed|ing)|swap(?:s|ped|ping)?\s+out|swap(?:s|ped|ping)?`,
    ),
  },
  {
    action: 'replace',
    kind: 'migrate',
    pattern: verbPattern(String.raw`switch(?:es|ed|ing)?\s+from`),
  },
  {
    action: 'migrate',
    kind: 'migrate',
    pattern: verbPattern(
      String.raw`migration\s+of|migrat(?:e|es|ed|ing)|mov(?:e|es|ed|ing)|cut(?:s|ting)?\s+over`,
    ),
  },
  { action: 'rename', kind: 'rename', pattern: verbPattern(String.raw`renam(?:e|es|ed|ing)`) },
  {
    action: 'upgrade',
    kind: 'migrate',
    pattern: verbPattern(String.raw`upgrade\s+of|upgrad(?:e|es|ed|ing)`),
  },
];

/** Words that end an object phrase. */
const STOP_WORDS = new Set([
  'to',
  'into',
  'onto',
  'with',
  'by',
  'for',
  'from',
  'on',
  'at',
  'before',
  'after',
  'until',
  'till',
  'because',
  'since',
  'as',
  'so',
  'once',
  'when',
  'while',
  'in',
  'within',
  'during',
  'which',
  'that',
  'who',
  'if',
  'unless',
  'per',
  'via',
  'across',
  'over',
  'under',
  'than',
  'instead',
  'is',
  'are',
  'was',
  'were',
  'will',
  'be',
  'been',
  'has',
  'have',
  'had',
  'should',
  'must',
  'can',
  'may',
  'then',
  'but',
  'except',
  'without',
  'where',
  'now',
  'next',
  'tomorrow',
  'today',
]);

/** Auxiliaries skipped when looking before a passive verb. */
const AUXILIARIES = new Set([
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'will',
  'shall',
  'would',
  'should',
  'must',
  'can',
  'could',
  'may',
  'might',
  'to',
  'has',
  'have',
  'had',
  'get',
  'gets',
  'got',
  'getting',
  'now',
  'fully',
  'also',
  'then',
  'finally',
  'permanently',
  'officially',
  'soon',
  'formally',
  'completely',
  'eventually',
  'going',
]);

const NEGATORS = new Set(['not', 'never', 'cannot', 'nor']);

/** A bare verb after these is a noun ("this upgrade improves ..."), not an action. */
const DETERMINERS = new Set([
  'the',
  'this',
  'that',
  'a',
  'an',
  'our',
  'its',
  'their',
  'any',
  'no',
  'each',
  'every',
  'planned',
  'proposed',
  'upcoming',
  'next',
  'last',
  'recent',
  'major',
  'minor',
  'big',
  'first',
  'second',
]);

/**
 * Generic words that never form a subject on their own, so "the old backup
 * service" or "Legacy Auth Tenant" yields nothing.
 */
const GENERIC = new Set(
  (
    'the a an this that these those our your their its all any some each every it them ' +
    'old older new newer legacy current existing unused deprecated primary secondary main ' +
    'internal external temporary manual default shared global local remaining previous ' +
    'service services server servers system systems provider providers tenant tenants ' +
    'backup backups platform platforms cluster clusters instance instances node nodes ' +
    'database databases db cache caches queue queues endpoint endpoints api apis app apps ' +
    'application applications tool tools tooling integration integrations component components ' +
    'module modules feature features flag flags job jobs script scripts process processes ' +
    'workflow workflows account accounts user users customer customers team teams ' +
    'environment environments env region regions version versions config configs ' +
    'configuration configurations setting settings support access auth authentication ' +
    'authorization login logins signin sso saml oidc oauth idp mfa otp storage network ' +
    'networking data file files page pages step steps runbook runbooks pipeline pipelines ' +
    'dashboard dashboards report reports key keys secret secrets certificate certificates ' +
    'cert certs domain domains host hosts hostname url urls link links email emails mail ' +
    'campaign campaigns template templates marketing website site sites portal ' +
    'gateway proxy load balancer vm vms container containers pod pods bucket buckets ' +
    'identity directory fallback failover replica replicas mirror mirrors connection ' +
    'connections connector connectors plugin plugins library libraries package packages ' +
    'dependency dependencies infrastructure infra stack stacks resource resources ' +
    'monitoring alert alerts alerting logging logs log metrics policy policies rule rules ' +
    'role roles group groups permission permissions license licenses contract vendor ' +
    'http https ssl tls sql dns cdn vpn ci cd ui ux eu us uk apac emea na qa pr it hr ' +
    'eta eod tbd fyi asap demo test tests testing todo note notes urgent important wip ' +
    'prod production staging dev development sandbox jan feb mar apr may jun jul aug sep ' +
    'sept oct nov dec january february march april june july august september october ' +
    'november december monday tuesday wednesday thursday friday saturday sunday ' +
    'we i you they he she team change changes request plan phase project ticket issue'
  ).split(/\s+/),
);

/** Common hyphenated English words that are not identifiers. */
const HYPHEN_COMMON = new Set(
  (
    'sign-in sign-on sign-up log-in self-service on-call follow-up end-of-life read-only ' +
    'one-time real-time third-party opt-in opt-out built-in add-on plug-in set-up roll-out ' +
    'roll-back fail-over e-mail re-run multi-factor single-sign-on long-term short-term ' +
    'high-availability point-in-time up-to-date out-of-date day-to-day back-end front-end ' +
    'end-to-end cross-region multi-region in-house on-premise on-premises on-prem ' +
    'well-known so-called e.g i.e etc'
  ).split(/\s+/),
);

const IGNORED_SHAPES = [
  /^[A-Z][A-Z0-9]+-\d+$/, // issue keys such as MC-12
  /^v?\d+(?:[.,]\d+)*$/i, // numbers and versions
  /^\d+[a-z]{1,3}$/i, // 30th, 5min, 10am
  /^(?:q[1-4]|h[12]|fy\d{2,4})$/i,
  /^\d{4}-\d{2}(?:-\d{2})?/,
];

type TokenClass = 'strong' | 'cap' | 'none';

function isGeneric(word: string): boolean {
  const lower = word.toLowerCase();
  return GENERIC.has(lower) || HYPHEN_COMMON.has(lower) || GENERIC.has(lower.replace(/s$/, ''));
}

function classify(token: Token, sentenceInitial: boolean): TokenClass {
  const text = token.text;
  if (token.backticked) {
    return normaliseTerm(text).length >= 2 ? 'strong' : 'none';
  }
  if (token.punct || IGNORED_SHAPES.some((p) => p.test(text))) {
    return 'none';
  }
  const hasLetter = /[A-Za-z]/.test(text);
  const strongShape =
    /[a-z][A-Z]/.test(text) ||
    (/[A-Z]{2,}[a-z]/.test(text) && !/^[A-Z]{2,}s$/.test(text)) ||
    (hasLetter && /\d/.test(text)) ||
    (hasLetter && /[._-]/.test(text) && text.length >= 4) ||
    /^[A-Z]{3,}$/.test(text);
  if (strongShape) {
    return isGeneric(text) ? 'none' : 'strong';
  }
  if (/^[A-Z][a-z]+$/.test(text) && !sentenceInitial) {
    return 'cap';
  }
  return 'none';
}

export interface Candidate {
  display: string;
  term: string;
}

/**
 * Distinctive names in a run of word tokens. Strong tokens stand alone;
 * consecutive capitalised words form one name ("Nimbus Vault") after generic
 * words are trimmed from either end.
 */
function candidatesIn(sentence: string, words: Token[], firstWordStart: number): Candidate[] {
  const out: Candidate[] = [];
  let run: Token[] = [];
  const flush = (): void => {
    let from = 0;
    let to = run.length;
    while (from < to && isGeneric(run[from]!.text)) from += 1;
    while (to > from && isGeneric(run[to - 1]!.text)) to -= 1;
    if (to > from) {
      const display = sentence.slice(run[from]!.start, run[to - 1]!.end);
      out.push({ display, term: normaliseTerm(display) });
    }
    run = [];
  };
  for (const token of words) {
    const kind = classify(token, token.start === firstWordStart);
    if (kind === 'strong') {
      flush();
      out.push({ display: token.text, term: normaliseTerm(token.text) });
    } else if (kind === 'cap' || (run.length > 0 && /^[A-Z][a-z]+$/.test(token.text))) {
      run.push(token);
    } else {
      flush();
    }
  }
  flush();
  return out.filter((c) => c.term.length >= 2 && !/^\d+$/.test(c.term));
}

interface Phrase {
  words: Token[];
  /** The stop word or punctuation that ended the phrase, lowercased, or null. */
  stop: string | null;
  /** Index of the first token after the stop. */
  next: number;
}

const MAX_PHRASE_WORDS = 10;

function startsName(token: Token | undefined, sentenceStart: number): boolean {
  return token !== undefined && classify(token, token.start === sentenceStart) !== 'none';
}

function takePhrase(tokens: Token[], from: number, sentenceStart: number): Phrase {
  const words: Token[] = [];
  let i = from;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.punct) {
      return { words, stop: token.text, next: i + 1 };
    }
    const lower = token.lower;
    if (
      lower === 'in' &&
      /^favou?r$/.test(tokens[i + 1]?.lower ?? '') &&
      tokens[i + 2]?.lower === 'of'
    ) {
      return { words, stop: 'in favour of', next: i + 3 };
    }
    if (!token.backticked && STOP_WORDS.has(lower)) {
      return { words, stop: lower, next: i + 1 };
    }
    if (!token.backticked && (lower === 'and' || lower === 'or' || lower === 'plus')) {
      let j = i + 1;
      while (j < tokens.length && /^(?:the|a|an|its|our)$/.test(tokens[j]!.lower)) j += 1;
      if (!startsName(tokens[j], sentenceStart)) {
        return { words, stop: lower, next: i + 1 };
      }
    }
    words.push(token);
    i += 1;
    if (words.length >= MAX_PHRASE_WORDS) {
      return { words, stop: null, next: i };
    }
  }
  return { words, stop: null, next: i };
}

/** Words before index `end`, back to the previous clause boundary, auxiliaries skipped. */
function phraseBefore(tokens: Token[], end: number): Token[] {
  let i = end - 1;
  while (i >= 0 && !tokens[i]!.punct && AUXILIARIES.has(tokens[i]!.lower)) i -= 1;
  const words: Token[] = [];
  while (i >= 0 && words.length < 6) {
    const token = tokens[i]!;
    if (token.punct || (!token.backticked && STOP_WORDS.has(token.lower))) break;
    words.unshift(token);
    i -= 1;
  }
  return words;
}

const REPLACEMENT_INTRODUCERS: Record<ClauseKind, Set<string>> = {
  object: new Set(['in favour of']),
  replace: new Set(['with', 'by', 'for', 'in favour of']),
  migrate: new Set(['to', 'into', 'onto', 'in favour of']),
  rename: new Set(['to', 'into', 'as', 'in favour of']),
};

const PRONOUNS = new Set(['it', 'them', 'this', 'these', 'those', 'that']);

const CANCEL_MARKERS = [
  /\b(?:cancell?ed|cancell?ing|cancellation|called off|abandoned|withdrawn|descoped|scrapped|won'?t do)\b/i,
  /\b(?:no longer|not)\s+(?:planned|going ahead|happening|proceeding|scheduled|in scope|required to happen)\b/i,
  /\b(?:was|were|has been|have been|had been|got|been|is being)\s+(?:reverted|rolled back)\b/i,
  /^(?:reverted|rolled back)\b/i,
];

const CANCELLED_STATUS =
  /^(?:cancell?ed|won'?t do|rejected|declined|abandoned|withdrawn|obsolete)$/i;

const HISTORY_PREFIX = /^(?:background|history|historical note|context|for context)\s*[:-]/i;
const HISTORY_WORDS =
  /\b(?:previously|formerly|historically|originally|already|years ago|last year|in the past|long ago|back then|at the time)\b/i;
const YEAR_MENTION =
  /\b(?:in|since|back in|during|by|until)\s+(?:early\s+|late\s+|mid-)?((?:19|20)\d{2})\b/gi;

const PARTIAL_MARKERS =
  /\b\d{1,3}(?:\.\d+)?\s?%|\bpercent\b|\b(?:some|part|half|a subset|a portion|a third|a quarter|most) of\b|\bsubset\b|\bpartial(?:ly)?\b|\bpilot\b|\bcanary\b|\bphase\s?(?:1|one|i)\b|\bfirst (?:phase|wave|batch)\b|\bonly (?:for|in)\b|\b(?:stays?|remains?|kept|keeps?|retained|continues?)\b(?:\s+\w+){0,2}\s+(?:for|in|available|active|running|live|online)\b|\bexcept\b|\bexcluding\b|\bstill (?:serves?|used|available|active|running)\b/i;

function isPastForm(verb: string): boolean {
  return /ed$|^(?:sunset|shut\s+down|t[oa]rn?\s+down|cut\s+over)$/i.test(verb);
}

function referenceYear(change: ChangeEvidence): number | null {
  const source = change.updated ?? change.retrievedAt;
  const match = source ? /^(\d{4})-/.exec(source) : null;
  return match ? Number(match[1]) : null;
}

function hasHistoricalMarker(sentence: string, refYear: number | null): boolean {
  if (HISTORY_WORDS.test(sentence)) {
    return true;
  }
  for (const match of sentence.matchAll(YEAR_MENTION)) {
    const year = Number(match[1]);
    if (refYear === null || year < refYear) {
      return true;
    }
  }
  return false;
}

interface VerbHit {
  rule: VerbRule;
  verb: string;
  /** Index of the first token of the verb. */
  first: number;
  /** Index of the first token after the verb. */
  after: number;
}

function verbHits(sentence: string, tokens: Token[]): VerbHit[] {
  const hits: VerbHit[] = [];
  for (const rule of VERB_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of sentence.matchAll(rule.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const first = tokens.findIndex((t) => t.start === start && !t.backticked);
      if (first < 0) continue; // inside a backticked span or an identifier
      let after = first;
      while (after < tokens.length && tokens[after]!.start < end) after += 1;
      hits.push({ rule, verb: match[0], first, after });
    }
  }
  return hits.sort((a, b) => a.first - b.first);
}

function isNegated(tokens: Token[], first: number): boolean {
  for (let i = first - 1, seen = 0; i >= 0 && seen < 3; i -= 1, seen += 1) {
    const token = tokens[i]!;
    if (token.punct) return false;
    if (NEGATORS.has(token.lower) || token.lower.endsWith("n't")) return true;
    if (token.lower === 'longer' && tokens[i - 1]?.lower === 'no') return true;
  }
  return false;
}

function isBareNoun(tokens: Token[], hit: VerbHit): boolean {
  if (/\s+of$/i.test(hit.verb)) return false;
  const previous = tokens[hit.first - 1];
  return previous !== undefined && !previous.punct && DETERMINERS.has(previous.lower);
}

/** Everything the engine learns from a change, beyond the public subjects. */
export interface ChangeReading {
  subjects: ChangeSubject[];
  /** Terms of subjects whose stated scope is partial. */
  partialTerms: string[];
  /** Names the change says will no longer be retired, replaced, etc. */
  cancelledNames: string[];
  /** True when the status or wording says the whole change is off. */
  changeCancelled: boolean;
}

interface Found extends ChangeSubject {
  order: number;
}

/** Reads a change: subjects plus cancellation and partial-scope signals. */
export function readChange(change: ChangeEvidence): ChangeReading {
  const sources: Sentence[] = [
    ...splitSentences(change.descriptionText ?? ''),
    ...splitSentences(change.summary),
  ];
  const refYear = referenceYear(change);
  const found: Found[] = [];
  const cancelled = new Map<string, string>();
  const changeReplacements: Candidate[] = [];
  let changeCancelled = CANCELLED_STATUS.test(change.status.trim());
  /** Terms named by each sentence with cancellation wording. */
  const cancelSentences: string[][] = [];

  sources.forEach((source, sentenceIndex) => {
    const text = source.text;
    const tokens = tokenize(text);
    const firstWord = tokens.find((t) => !t.punct);
    const sentenceStart = firstWord ? firstWord.start : -1;
    const historicalSentence = HISTORY_PREFIX.test(text);
    const cancelMarker = CANCEL_MARKERS.some((p) => p.test(text));
    let negatedVerb = false;

    for (const hit of verbHits(text, tokens)) {
      if (isBareNoun(tokens, hit)) continue;
      if (isNegated(tokens, hit.first)) {
        negatedVerb = true;
        continue;
      }
      if (historicalSentence) continue;
      const past = isPastForm(hit.verb);
      if (past && hasHistoricalMarker(text, refYear)) continue;

      const { kind } = hit.rule;
      let phrase = takePhrase(tokens, hit.after, sentenceStart);
      let subjectWords = phrase.words;
      if (kind === 'migrate' && phrase.stop === 'from') {
        const fromPhrase = takePhrase(tokens, phrase.next, sentenceStart);
        if (candidatesIn(text, subjectWords, sentenceStart).length === 0) {
          subjectWords = fromPhrase.words;
        }
        phrase = fromPhrase;
      }
      let subjects = candidatesIn(text, subjectWords, sentenceStart);
      const objectIsPronoun =
        subjectWords.length === 1 && PRONOUNS.has(subjectWords[0]!.lower) && kind === 'replace';

      let replacement: Candidate | undefined;
      if (phrase.stop !== null && REPLACEMENT_INTRODUCERS[kind].has(phrase.stop)) {
        replacement = candidatesIn(
          text,
          takePhrase(tokens, phrase.next, sentenceStart).words,
          sentenceStart,
        )[0];
      }
      const before = candidatesIn(text, phraseBefore(tokens, hit.first), sentenceStart);
      const imperative = hit.first === 0 || tokens[hit.first]!.start === sentenceStart;
      if (subjects.length === 0 && past && !objectIsPronoun) {
        // Passive or headline form: "LegacyAuth will be retired", "LegacyAuth retired".
        subjects = before;
      } else if (
        kind === 'replace' &&
        !replacement &&
        !imperative &&
        /s$|ed$|ing$/i.test(hit.verb)
      ) {
        // "NimbusID replaces LegacyAuth" / "NimbusID replaces it".
        replacement = before[0];
      }
      if (objectIsPronoun) {
        if (replacement) changeReplacements.push(replacement);
        continue;
      }
      for (const subject of subjects) {
        if (replacement && replacement.term === subject.term) continue;
        found.push({
          term: subject.term,
          display: subject.display,
          action: hit.rule.action,
          excerpt: text,
          ...(replacement ? { replacement: replacement.display } : {}),
          order: sentenceIndex * 1000 + hit.first,
        });
      }
    }

    if (cancelMarker || negatedVerb) {
      const named = candidatesIn(
        text,
        tokens.filter((t) => !t.punct),
        sentenceStart,
      );
      for (const name of named) {
        if (!cancelled.has(name.term)) cancelled.set(name.term, name.display);
      }
      if (cancelMarker) {
        cancelSentences.push(named.map((n) => n.term));
      }
    }
  });

  // Cancellation wording that names none of the change's subjects ("This
  // change was cancelled by the CAB.") applies to the whole change.
  const foundTerms = new Set(found.map((f) => f.term));
  if (cancelSentences.some((terms) => !terms.some((t) => foundTerms.has(t)))) {
    changeCancelled = true;
  }

  // Merge duplicates by term: first occurrence wins, a later replacement fills a gap.
  const byTerm = new Map<string, Found>();
  for (const item of found.sort((a, b) => a.order - b.order)) {
    const existing = byTerm.get(item.term);
    if (!existing) {
      byTerm.set(item.term, { ...item });
    } else if (!existing.replacement && item.replacement) {
      existing.replacement = item.replacement;
    }
  }

  // A single change-level replacement ("NimbusID replaces it") fills remaining gaps.
  const distinctReplacements = [...new Set(changeReplacements.map((r) => r.display))];
  const replacementTerms = new Set(changeReplacements.map((r) => r.term));

  const subjects: ChangeSubject[] = [];
  for (const item of byTerm.values()) {
    if (changeCancelled || cancelled.has(item.term)) continue;
    if (replacementTerms.has(item.term) && item.action !== 'upgrade') continue;
    const subject: ChangeSubject = {
      term: item.term,
      display: item.display,
      action: item.action,
      excerpt: item.excerpt,
      ...(item.replacement ? { replacement: item.replacement } : {}),
    };
    if (!subject.replacement && distinctReplacements.length === 1 && subject.action !== 'upgrade') {
      subject.replacement = distinctReplacements[0]!;
    }
    subjects.push(subject);
  }

  const partialTerms = subjects
    .filter((s) =>
      sources.some(
        (source) =>
          PARTIAL_MARKERS.test(source.text) &&
          (source.text === s.excerpt || mentionsTerm(source.text, s.term, s.display)),
      ),
    )
    .map((s) => s.term);

  return {
    subjects,
    partialTerms,
    cancelledNames: [...cancelled.values()],
    changeCancelled,
  };
}

/**
 * What the change retires, replaces, migrates, renames, disables or upgrades.
 * Deterministic; the input is not modified. See the rules at the top of this file.
 */
export function extractChangeSubjects(change: ChangeEvidence): ChangeSubject[] {
  return readChange(change).subjects;
}
