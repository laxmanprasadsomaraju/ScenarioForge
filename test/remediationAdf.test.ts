import { describe, expect, it } from 'vitest';
import { analyzeChange } from '../shared/analysis';
import type { ChangeAnalysis } from '../shared/analysis/types';
import {
  buildWorkItemDraft,
  CREATED_BY_FOOTER,
  descriptionBlocks,
  descriptionToAdf,
  FIXED_ISSUE_TYPES,
  httpsOrigin,
  isUrlOnOrigin,
  type AdfDoc,
  type BuildDraftOptions,
} from '../shared/remediation';
import { canonicalJson } from '../shared/simulation/replay';
import { adfToText } from '../src/jira/adf';
import { change, RB_AUTH_STEPS, runbook } from './fixtures/analysis/cases';

/**
 * M8: plain-text draft description to ADF. Built from the MC-62 / RB-AUTH-01
 * synthetic texts, so the quotes are the real engine output.
 */

const AT = '2026-11-10T09:30:00.000Z';
const SITE = 'https://example.atlassian.net';
const RB_TITLE = '[DEMO] RB-AUTH-01 Customer sign-in recovery';
const CHANGE_QUOTE = 'We will decommission the LegacyAuth tenant on 30 November.';
const STEP_QUOTE = RB_AUTH_STEPS[2]!;

const analysis: ChangeAnalysis = analyzeChange(
  change(
    'MC-62',
    '[DEMO] Retire LegacyAuth backup SSO tenant',
    `Synthetic change for ScenarioForge testing.\n\n${CHANGE_QUOTE} NimbusID replaces LegacyAuth as the secondary identity provider.`,
    { origin: 'live' },
  ),
  [{ ...runbook('98305', RB_TITLE, RB_AUTH_STEPS, 'Related change: MC-62'), origin: 'live' }],
  AT,
);
const finding = analysis.findings[0]!;

const BASE: BuildDraftOptions = {
  projectKey: 'OPS',
  issueType: 'Task',
  issueTypes: FIXED_ISSUE_TYPES,
  fix: {
    id: 'rem-step',
    title: `Update ${RB_TITLE} step 3`,
    description: 'Replace the dependency on LegacyAuth in step 3 with NimbusID, as named in MC-62.',
  },
  siteUrl: SITE,
};

function description(options: Partial<BuildDraftOptions> = {}): string {
  const result = buildWorkItemDraft(finding, analysis, undefined, { ...BASE, ...options });
  if (!result.ok) throw new Error(result.message);
  return result.draft.description;
}

type Node = { type: string; text?: string; content?: Node[]; marks?: unknown[] };

/** Text of every text node under `node`, in order, with hard breaks as `\n`. */
function rawText(node: Node): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(rawText).join('');
}

/** Checks the ADF schema rules this module relies on (adf-schema full.json). */
function assertSchema(doc: AdfDoc): void {
  expect(Object.keys(doc).sort()).toEqual(['content', 'type', 'version']);
  expect(doc.version).toBe(1);
  expect(doc.type).toBe('doc');
  const visit = (node: Node, parent: string) => {
    switch (node.type) {
      case 'paragraph':
        expect(['doc', 'blockquote']).toContain(parent);
        expect(Object.keys(node).sort()).toEqual(['content', 'type']);
        break;
      case 'blockquote':
        expect(parent).toBe('doc');
        expect(node.content!.length).toBeGreaterThan(0);
        expect(node.content!.every((c) => c.type === 'paragraph')).toBe(true);
        break;
      case 'text':
        expect(parent).toBe('paragraph');
        expect(node.text!.length).toBeGreaterThan(0);
        for (const mark of node.marks ?? []) {
          expect(mark).toEqual({ type: 'link', attrs: { href: node.text } });
        }
        break;
      case 'hardBreak':
        expect(parent).toBe('paragraph');
        expect(Object.keys(node)).toEqual(['type']);
        break;
      default:
        throw new Error(`Unexpected node ${node.type}`);
    }
    for (const child of node.content ?? []) visit(child, node.type);
  };
  for (const node of doc.content as Node[]) visit(node, 'doc');
}

describe('descriptionToAdf', () => {
  it('converts blocks, quotes, links and the footer exactly', () => {
    const text = [
      'Intro line.',
      `Change: MC-62 Retire\nLink: ${SITE}/browse/MC-62`,
      'Quoted exactly from MC-62:\nFirst "quoted" line.\nSecond line.',
      CREATED_BY_FOOTER,
    ].join('\n\n');
    expect(descriptionToAdf(text, SITE)).toEqual({
      version: 1,
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro line.' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Change: MC-62 Retire' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Link: ' },
            {
              type: 'text',
              text: `${SITE}/browse/MC-62`,
              marks: [{ type: 'link', attrs: { href: `${SITE}/browse/MC-62` } }],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Quoted exactly from MC-62:' }] },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'First "quoted" line.' },
                { type: 'hardBreak' },
                { type: 'text', text: 'Second line.' },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: CREATED_BY_FOOTER }] },
      ],
    });
  });

  it('puts both quotes from a real draft in blockquotes, character for character', () => {
    const doc = descriptionToAdf(description(), SITE);
    assertSchema(doc);
    const quotes = (doc.content as Node[]).filter((n) => n.type === 'blockquote').map(rawText);
    expect(quotes).toEqual([CHANGE_QUOTE, STEP_QUOTE]);
    expect(STEP_QUOTE).toContain('`authctl failover --target legacyauth`');
    const last = doc.content.at(-1) as Node;
    expect(last).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: CREATED_BY_FOOTER }],
    });
  });

  it('links both site URLs in a real draft and nothing else', () => {
    const doc = descriptionToAdf(description(), SITE);
    const marked: string[] = [];
    const walk = (node: Node) => {
      if (node.type === 'text' && node.marks) marked.push(node.text!);
      node.content?.forEach(walk);
    };
    (doc.content as Node[]).forEach(walk);
    expect(marked).toEqual([
      `${SITE}/browse/MC-62`,
      `${SITE}/wiki/spaces/SFDEMO/pages/98305/+DEMO+RB+AUTH+01+Customer+sign+in+recovery`,
    ]);
  });

  it('round-trips through the ADF flattener', () => {
    const samples = [
      description(),
      description({ fix: undefined }),
      description({ siteUrl: null }),
      'One line',
      'Quoted exactly from X:\nSmart ‘quotes’ “stay” and straight "ones" \'too\'\n\nTabs\tand  double  spaces',
      'a\r\nb\r\n\r\nc\rd',
      '  leading and trailing  \n\n\n\n   \n\nafter blank lines',
      `Link: ${SITE}/browse/MC-1\nLink: https://evil.example.com/x\nLink: http://example.atlassian.net/x`,
    ];
    for (const text of samples) {
      const doc = descriptionToAdf(text, SITE);
      assertSchema(doc);
      expect(adfToText(doc)).toBe(adfToText(text));
    }
  });

  it('reproduces the quoted text exactly after flattening', () => {
    const flattened = adfToText(descriptionToAdf(description(), SITE))!.split('\n');
    expect(flattened).toContain(CHANGE_QUOTE);
    expect(flattened).toContain(STEP_QUOTE);
    expect(flattened.at(-1)).toBe(CREATED_BY_FOOTER);
  });

  it('keeps every character of a quote, including quote marks and spacing', () => {
    const quote = 'He said "don\'t"  —  ‘then’ `run x`\tnow ';
    const doc = descriptionToAdf(`Quoted exactly from MC-1:\n${quote}`, SITE);
    expect(rawText(doc.content[1] as Node)).toBe(quote);
  });

  it('never links URLs inside quotes, off the site, not https, or without an origin', () => {
    const marks = (text: string, origin: string | null = SITE) =>
      JSON.stringify(descriptionToAdf(text, origin)).includes('"link"');
    expect(marks(`Link: ${SITE}/browse/MC-1`)).toBe(true);
    expect(marks(`Link: ${SITE}/browse/MC-1`, null)).toBe(false);
    expect(marks(`Link: ${SITE}/browse/MC-1`, 'http://example.atlassian.net')).toBe(false);
    expect(marks(`Quoted exactly from MC-1:\nLink: ${SITE}/browse/MC-1`)).toBe(false);
    for (const url of [
      'https://evil.example.com/browse/MC-1',
      'http://example.atlassian.net/browse/MC-1',
      'https://example.atlassian.net.evil.com/x',
      'https://example.atlassian.net@evil.com/x',
      'https://example.atlassian.net:8443/x',
      '//example.atlassian.net/x',
      '/browse/MC-1',
      'javascript:alert(1)',
      `${SITE}/browse/MC-1 extra`,
      `${SITE}/a"b`,
    ]) {
      expect(marks(`Link: ${url}`)).toBe(false);
    }
    // Only lines that start with "Link: " are ever linked.
    expect(marks(`See ${SITE}/browse/MC-1`)).toBe(false);
  });

  it('is deterministic', () => {
    const text = description();
    expect(canonicalJson(descriptionToAdf(text, SITE))).toBe(
      canonicalJson(descriptionToAdf(text, SITE)),
    );
    expect(JSON.stringify(descriptionToAdf(text, SITE))).toBe(
      JSON.stringify(descriptionToAdf(text, SITE)),
    );
  });

  it('groups lines into blocks on blank or whitespace-only lines', () => {
    expect(descriptionBlocks('a\nb\n\n \n\nc')).toEqual([['a', 'b'], ['c']]);
    expect(descriptionBlocks('')).toEqual([]);
    expect(descriptionToAdf('', SITE)).toEqual({ version: 1, type: 'doc', content: [] });
  });
});

describe('URL origin checks', () => {
  it('accepts only absolute https URLs on the exact origin', () => {
    expect(httpsOrigin(`${SITE}/browse/MC-1`)).toBe(SITE);
    expect(httpsOrigin('https://Example.Atlassian.net/x')).toBe(SITE);
    expect(httpsOrigin('http://example.atlassian.net/x')).toBeNull();
    expect(httpsOrigin('/browse/MC-1')).toBeNull();
    expect(isUrlOnOrigin(`${SITE}/wiki/x`, SITE)).toBe(true);
    expect(isUrlOnOrigin(`${SITE}/wiki/x`, 'https://other.atlassian.net')).toBe(false);
    expect(isUrlOnOrigin(`${SITE}/wiki/x`, `${SITE}/`)).toBe(false);
  });
});
