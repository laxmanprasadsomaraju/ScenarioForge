/**
 * Atlassian Document Format (ADF) to plain text.
 *
 * Jira REST v3 returns rich text fields (such as `description`) as an ADF JSON
 * tree. Change analysis needs the words as written, so this flattener keeps
 * the text of every node verbatim and only decides where lines break. It never
 * renders or interprets markup, and the result must be shown as plain text.
 *
 * Whitespace normalisation (the only change made to the text):
 * - Block nodes (paragraphs, headings, list items, code blocks, table cells,
 *   ...) and hard breaks end a line.
 * - Within a line, runs of whitespace and control characters become one space,
 *   and the line is trimmed. Empty lines are dropped.
 * - No list markers, heading markers or other decoration is added, so any
 *   sentence quoted from the output appears in the issue exactly as written.
 *
 * Safety: the input is untrusted JSON. Nesting deeper than `MAX_DEPTH`, more
 * than `MAX_NODES` nodes, or more than `MAX_TEXT_CHARS` of text stops the walk
 * (the text read so far is kept). Unknown node types are not interpreted: only
 * the text of their child nodes is kept, and their attributes are ignored.
 */

export const MAX_DEPTH = 32;
export const MAX_NODES = 10_000;
export const MAX_TEXT_CHARS = 50_000;

/** Inline nodes whose readable text lives in `attrs.text`. */
const ATTR_TEXT_NODES = new Set(['mention', 'status', 'placeholder']);

/** Inline nodes that keep the current line going. */
const INLINE_NODES = new Set([
  'text',
  'mention',
  'emoji',
  'status',
  'placeholder',
  'inlineCard',
  'date',
  'hardBreak',
  'mediaInline',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

interface WalkState {
  lines: string[];
  current: string;
  nodes: number;
  chars: number;
  stopped: boolean;
}

function endLine(state: WalkState): void {
  if (state.current.length > 0) {
    state.lines.push(state.current);
  }
  state.current = '';
}

function append(state: WalkState, text: string): void {
  const room = MAX_TEXT_CHARS - state.chars;
  if (room <= 0) {
    state.stopped = true;
    return;
  }
  const kept = text.length > room ? text.slice(0, room) : text;
  state.current += kept;
  state.chars += kept.length;
  if (kept.length < text.length) {
    state.stopped = true;
  }
}

/** ADF dates are epoch milliseconds as a string; shown as an ISO date. */
function dateText(timestamp: unknown): string | null {
  const ms =
    typeof timestamp === 'string' && /^-?\d{1,15}$/.test(timestamp) ? Number(timestamp) : NaN;
  const date = new Date(ms);
  return Number.isFinite(ms) && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

function inlineText(type: string, attrs: Record<string, unknown> | null): string | null {
  if (ATTR_TEXT_NODES.has(type)) {
    return asString(attrs?.text);
  }
  switch (type) {
    case 'emoji':
      return asString(attrs?.text) ?? asString(attrs?.shortName);
    case 'inlineCard':
      return asString(attrs?.url);
    case 'date':
      return dateText(attrs?.timestamp);
    default:
      return null;
  }
}

function visit(node: unknown, depth: number, state: WalkState): void {
  if (state.stopped) {
    return;
  }
  if (depth > MAX_DEPTH || state.nodes >= MAX_NODES) {
    state.stopped = true;
    return;
  }
  state.nodes += 1;

  const record = asRecord(node);
  if (!record) {
    return;
  }
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'text') {
    if (typeof record.text === 'string') {
      append(state, record.text);
    }
    return;
  }
  if (type === 'hardBreak') {
    endLine(state);
    return;
  }
  if (INLINE_NODES.has(type)) {
    const text = inlineText(type, asRecord(record.attrs));
    if (text) {
      append(state, text);
    }
    return;
  }

  // Every other node (known block or unknown) is treated as a block: it starts
  // and ends a line, and only its children's text is read.
  endLine(state);
  if (type === 'blockCard' || type === 'embedCard') {
    const url = asString(asRecord(record.attrs)?.url);
    if (url) {
      append(state, url);
    }
  }
  if (Array.isArray(record.content)) {
    for (const child of record.content) {
      visit(child, depth + 1, state);
      if (state.stopped) {
        break;
      }
    }
  }
  endLine(state);
}

/** Collapses whitespace and control characters within one line. */
function normaliseLine(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

function normalise(text: string): string | null {
  const result = text
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map(normaliseLine)
    .filter((line) => line.length > 0)
    .join('\n');
  return result.length > 0 ? result : null;
}

/**
 * Flattens an ADF document to plain text, or returns null when there is no
 * readable text. A plain string (Jira REST v2 style) is normalised the same
 * way; any other value yields null.
 */
export function adfToText(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalise(value.slice(0, MAX_TEXT_CHARS));
  }
  if (!asRecord(value)) {
    return null;
  }
  const state: WalkState = { lines: [], current: '', nodes: 0, chars: 0, stopped: false };
  visit(value, 0, state);
  endLine(state);
  return normalise(state.lines.join('\n'));
}
