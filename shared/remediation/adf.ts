/**
 * Plain-text draft description to Atlassian Document Format (ADF).
 *
 * `POST /rest/api/3/issue` takes `description` as ADF (Jira platform REST v3,
 * createIssue: "the `description`, `environment`, and any `textarea` type
 * custom fields ... take Atlassian Document Format content"). Node shapes
 * follow the ADF reference, read 2026-11-10:
 * - https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 *   (root `{ version: 1, type: 'doc', content }`; `paragraph` and `blockquote`
 *   are top-level block nodes)
 * - .../document/nodes/blockquote/ (content: one or more `paragraph`s, among others)
 * - .../document/nodes/paragraph/, .../nodes/text/ (`text` must not be empty),
 *   .../nodes/hardBreak/
 * - .../document/marks/link/ (`attrs.href` required)
 * and the published JSON schema `@atlaskit/adf-schema` 57.7.39
 * `dist/json-schema/v1/full.json` (`text_node.text` minLength 1,
 * `blockquote_node.content` minItems 1, `link_mark.attrs.href` required).
 *
 * Rules (deterministic, no clock, no randomness):
 * - Blank lines separate blocks; each block is one `paragraph`, and single
 *   line breaks inside a block become `hardBreak`s.
 * - A block whose first line is `Quoted exactly from …:` is that line as a
 *   paragraph, then the remaining lines in a `blockquote`. Quoted text is
 *   copied character for character: no trimming, no smart quotes, no marks.
 * - A line `Link: <url>` gets a `link` mark on the URL only when it is an
 *   absolute https URL on `linkOrigin` (the trusted site). Any other URL stays
 *   plain text, so a quote or an edit can never introduce a clickable link to
 *   another host.
 * - The footer and every other block are plain paragraphs.
 *
 * Flattening the result with src/jira/adf.ts `adfToText` gives the same text
 * as normalising the description itself (test/remediationAdf.test.ts).
 */

export interface AdfLinkMark {
  type: 'link';
  attrs: { href: string };
}

export interface AdfText {
  type: 'text';
  text: string;
  marks?: AdfLinkMark[];
}

export interface AdfHardBreak {
  type: 'hardBreak';
}

export type AdfInline = AdfText | AdfHardBreak;

export interface AdfParagraph {
  type: 'paragraph';
  content: AdfInline[];
}

export interface AdfBlockquote {
  type: 'blockquote';
  content: AdfParagraph[];
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: (AdfParagraph | AdfBlockquote)[];
}

export const QUOTE_HEADING_PREFIX = 'Quoted exactly from ';
export const LINK_LINE_PREFIX = 'Link: ';

/** A site origin: https, a dotted host name, nothing else. */
export const SITE_ORIGIN_PATTERN = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Absolute https URL: dotted host, no user info, no port, and a path made only
 * of RFC 3986 unreserved, sub-delim, `:@/?#` and percent characters.
 */
const ABSOLUTE_HTTPS_URL =
  /^(https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#]*)?$/;

/**
 * The origin of `url` when it is an absolute https URL of the accepted shape,
 * otherwise null. Never resolves relative URLs.
 */
export function httpsOrigin(url: string): string | null {
  const match = ABSOLUTE_HTTPS_URL.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

/** True when `url` is an absolute https URL on exactly `origin`. */
export function isUrlOnOrigin(url: string, origin: string): boolean {
  return SITE_ORIGIN_PATTERN.test(origin) && httpsOrigin(url) === origin.toLowerCase();
}

function text(value: string): AdfText {
  return { type: 'text', text: value };
}

function lineContent(line: string, linkOrigin: string | null): AdfInline[] {
  if (line.startsWith(LINK_LINE_PREFIX) && linkOrigin !== null) {
    const url = line.slice(LINK_LINE_PREFIX.length);
    if (isUrlOnOrigin(url, linkOrigin)) {
      return [
        text(LINK_LINE_PREFIX),
        { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] },
      ];
    }
  }
  return [text(line)];
}

function paragraph(lines: readonly string[], linkOrigin: string | null): AdfParagraph {
  const content: AdfInline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    content.push(...lineContent(line, linkOrigin));
  });
  return { type: 'paragraph', content };
}

/** Lines of `description` grouped into blocks; blank or whitespace-only lines separate blocks. */
export function descriptionBlocks(description: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of description.split(/\r\n|\r|\n/)) {
    if (line.trim() === '') {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Converts the plain-text description to an ADF document.
 *
 * `linkOrigin` is the trusted site origin (e.g. `https://example.atlassian.net`);
 * null means no link marks at all.
 */
export function descriptionToAdf(description: string, linkOrigin: string | null): AdfDoc {
  const origin = linkOrigin !== null && SITE_ORIGIN_PATTERN.test(linkOrigin) ? linkOrigin : null;
  const content: AdfDoc['content'] = [];
  for (const lines of descriptionBlocks(description)) {
    const [first, ...rest] = lines as [string, ...string[]];
    if (first.startsWith(QUOTE_HEADING_PREFIX) && first.endsWith(':') && rest.length > 0) {
      content.push(paragraph([first], origin));
      // Quoted text is never linked: it is evidence, shown exactly as written.
      content.push({ type: 'blockquote', content: [paragraph(rest, null)] });
    } else {
      content.push(paragraph(lines, origin));
    }
  }
  return { version: 1, type: 'doc', content };
}
