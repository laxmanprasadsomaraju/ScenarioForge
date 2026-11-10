/**
 * Text helpers for the change-to-recovery engine: sentence splitting,
 * tokenising, term normalisation and word-boundary matching.
 *
 * Pure and deterministic: no clock reads, randomness, I/O or AI.
 */

/** A sentence as written in the source; `text` is an exact substring of it. */
export interface Sentence {
  text: string;
  /** Offset of `text` in the source string. */
  start: number;
}

/** Leading list markers that are not part of the sentence. */
const BULLET = /^(?:[-*•‣◦+>]|\d{1,3}[.)]|[a-zA-Z][.)]|\[[ xX]?\])\s+/;

/**
 * Splits text into sentences. Lines are split first (descriptions are often
 * bullet lists), then on `.`, `!`, `?` or `;` followed by whitespace, so
 * hostnames such as `auth.example.com` stay whole. Bullet markers are dropped
 * from the front; every returned text is an exact substring of the input.
 */
export function splitSentences(source: string): Sentence[] {
  const out: Sentence[] = [];
  const linePattern = /[^\r\n]+/g;
  let line: RegExpExecArray | null;
  while ((line = linePattern.exec(source)) !== null) {
    let offset = line.index;
    let text = line[0];
    const leading = /^\s*/.exec(text)![0].length;
    offset += leading;
    text = text.slice(leading);
    const bullet = BULLET.exec(text);
    if (bullet) {
      offset += bullet[0].length;
      text = text.slice(bullet[0].length);
    }
    const piecePattern = /\S(?:[\s\S]*?)(?:[.!?;](?=\s|$)|$)/g;
    let piece: RegExpExecArray | null;
    while ((piece = piecePattern.exec(text)) !== null) {
      const trimmed = piece[0].trimEnd();
      if (/[A-Za-z0-9]/.test(trimmed)) {
        out.push({ text: trimmed, start: offset + piece.index });
      }
    }
  }
  return out;
}

export interface Token {
  /** Text as written (without backticks for a backticked span). */
  text: string;
  /** Offsets in the sentence, including backticks when present. */
  start: number;
  end: number;
  /** Lowercased text, for keyword checks. */
  lower: string;
  backticked: boolean;
  /** Punctuation that ends a clause (`,` `;` `:` brackets, dashes, sentence end). */
  punct: boolean;
}

const TOKEN_PATTERN =
  /`([^`\n]{1,80})`|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:'[A-Za-z]+)?|[,;:()[\]{}!?"]|\.(?=\s|$)|\s[-–—]\s|[–—]/g;

/** Splits a sentence into word and punctuation tokens with their offsets. */
export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(sentence)) !== null) {
    const raw = match[0];
    if (match[1] !== undefined) {
      const inner = match[1].trim();
      if (inner.length > 0) {
        tokens.push({
          text: inner,
          start: match.index,
          end: match.index + raw.length,
          lower: inner.toLowerCase(),
          backticked: true,
          punct: false,
        });
      }
      continue;
    }
    const isWord = /^[A-Za-z0-9]/.test(raw);
    // Possessive or contraction suffixes ("LegacyAuth's", "won't") are kept in
    // `lower` for keyword checks but dropped from the word itself.
    const word = isWord ? raw.replace(/'s$/i, '') : raw.trim();
    tokens.push({
      text: word,
      start: match.index,
      end: match.index + (isWord ? word.length : raw.length),
      lower: raw.toLowerCase().trim(),
      backticked: false,
      punct: !isWord,
    });
  }
  return tokens;
}

/** Lowercase alphanumerics only: "Legacy-Auth" and "LegacyAuth" become "legacyauth". */
export function normaliseTerm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Word parts of a display name: "LegacyAuth" -> legacy, auth; "auth.example.com" -> auth, example, com. */
export function termParts(display: string): string[] {
  return display
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `text` names the subject as a whole word. Matching is
 * case-insensitive and tolerant of separators between word parts, so
 * "LegacyAuth" matches "legacyauth", "Legacy-Auth" and "--target legacyauth",
 * while "auth" does not match "authctl" or "oauth".
 */
export function mentionsTerm(text: string, term: string, display: string): boolean {
  const lower = text.toLowerCase();
  const parts = termParts(display);
  if (parts.length > 0) {
    const pattern = new RegExp(
      `(?<![a-z0-9])${parts.map(escapeRegExp).join('[\\s._-]*')}(?![a-z0-9])`,
    );
    if (pattern.test(lower)) {
      return true;
    }
  }
  // Fallback: a token that normalises to the term ("legacy_auth" for "legacyauth").
  return lower
    .split(/[^a-z0-9._-]+/)
    .some((token) => token.length > 0 && normaliseTerm(token) === term);
}

/** True when `text` contains `key` (e.g. MC-12) as a whole token, not MC-123 or XMC-12. */
export function mentionsIssueKey(text: string, key: string): boolean {
  if (key.length === 0) {
    return false;
  }
  return new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(key)}(?![0-9A-Za-z])`).test(text);
}
