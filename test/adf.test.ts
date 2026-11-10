import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, MAX_NODES, MAX_TEXT_CHARS, adfToText } from '../src/jira/adf';

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const li = (...content: unknown[]) => ({ type: 'listItem', content });

describe('adfToText', () => {
  it('joins inline text of a paragraph verbatim, ignoring marks', () => {
    expect(
      adfToText(doc(p(t('Retire '), t('LegacyAuth', [{ type: 'strong' }]), t(' on Friday.')))),
    ).toBe('Retire LegacyAuth on Friday.');
  });

  it('puts each block on its own line without adding markers', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [t('Plan')] },
      p(t('First paragraph.')),
      {
        type: 'bulletList',
        content: [li(p(t('Disable legacyauth'))), li(p(t('Remove DNS record')))],
      },
      {
        type: 'orderedList',
        attrs: { order: 3 },
        content: [li(p(t('Migrate users to NimbusID')))],
      },
      { type: 'blockquote', content: [p(t('Quoted.'))] },
      { type: 'rule' },
      p(t('Last.')),
    );
    expect(adfToText(value)).toBe(
      [
        'Plan',
        'First paragraph.',
        'Disable legacyauth',
        'Remove DNS record',
        'Migrate users to NimbusID',
        'Quoted.',
        'Last.',
      ].join('\n'),
    );
  });

  it('keeps nested list item text on separate lines', () => {
    const value = doc({
      type: 'bulletList',
      content: [
        li(p(t('Outer')), { type: 'bulletList', content: [li(p(t('Inner')))] }),
        li(p(t('Next'))),
      ],
    });
    expect(adfToText(value)).toBe('Outer\nInner\nNext');
  });

  it('splits code blocks into lines and keeps inline code text', () => {
    const value = doc(
      {
        type: 'codeBlock',
        attrs: { language: 'bash' },
        content: [t('kubectl delete svc legacyauth\n  --now')],
      },
      p(t('Run '), t('legacyauth-cli stop', [{ type: 'code' }]), t(' first.')),
    );
    expect(adfToText(value)).toBe(
      'kubectl delete svc legacyauth\n--now\nRun legacyauth-cli stop first.',
    );
  });

  it('turns hard breaks into new lines', () => {
    expect(adfToText(doc(p(t('Line one'), { type: 'hardBreak' }, t('Line two'))))).toBe(
      'Line one\nLine two',
    );
  });

  it('renders mentions, emoji, status, dates and cards as text', () => {
    const value = doc(
      p(
        t('Owner '),
        { type: 'mention', attrs: { id: 'abc', text: '@Ana Ops' } },
        t(' '),
        { type: 'emoji', attrs: { shortName: ':warning:', text: '⚠️' } },
        t(' '),
        { type: 'emoji', attrs: { shortName: ':custom:' } },
        t(' '),
        { type: 'status', attrs: { text: 'BLOCKED', color: 'red' } },
        t(' on '),
        { type: 'date', attrs: { timestamp: '1767225600000' } },
        t(' see '),
        { type: 'inlineCard', attrs: { url: 'https://example.atlassian.net/wiki/x/AbC' } },
      ),
      { type: 'blockCard', attrs: { url: 'https://example.com/runbook' } },
    );
    expect(adfToText(value)).toBe(
      'Owner @Ana Ops ⚠️ :custom: BLOCKED on 2026-01-01 see https://example.atlassian.net/wiki/x/AbC\nhttps://example.com/runbook',
    );
  });

  it('reads tables cell by cell and panels and expands as blocks', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [p(t(text))] });
    const value = doc(
      { type: 'table', content: [{ type: 'tableRow', content: [cell('A'), cell('B')] }] },
      { type: 'panel', attrs: { panelType: 'info' }, content: [p(t('Note'))] },
      { type: 'expand', attrs: { title: 'ignored title' }, content: [p(t('Hidden'))] },
    );
    expect(adfToText(value)).toBe('A\nB\nNote\nHidden');
  });

  it('reads text inside unknown nodes but ignores their attributes', () => {
    const value = doc(
      { type: 'futureNode', attrs: { text: 'attr text' }, content: [p(t('child text'))] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'x' } }] },
      { type: 'extension', attrs: { extensionKey: 'macro', text: 'no' } },
    );
    expect(adfToText(value)).toBe('child text');
  });

  it('tolerates malformed nodes', () => {
    const value = doc(
      null,
      42,
      'string node',
      [t('array')],
      { type: 'text', text: 7 },
      { type: 'paragraph', content: 'nope' },
      { type: 'mention', attrs: null },
      { type: 'date', attrs: { timestamp: 'not a date' } },
      p(t('ok')),
    );
    expect(adfToText(value)).toBe('ok');
  });

  it('collapses whitespace and control characters within a line', () => {
    expect(adfToText(doc(p(t('  Retire\t\tLegacyAuth \u0007 now  '))))).toBe(
      'Retire LegacyAuth now',
    );
  });

  it.each([null, undefined, 42, [], { type: 'doc' }, doc(), doc(p()), doc(p(t('   ')))])(
    'returns null when there is no text (%j)',
    (value) => {
      expect(adfToText(value)).toBeNull();
    },
  );

  it('normalises a plain string description', () => {
    expect(adfToText('Retire  LegacyAuth\r\n\r\nthen  migrate')).toBe(
      'Retire LegacyAuth\nthen migrate',
    );
  });

  it('stops at the depth limit and keeps text read so far', () => {
    let node: Record<string, unknown> = p(t('too deep'));
    for (let i = 0; i < MAX_DEPTH + 5; i++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(adfToText(doc(p(t('shallow')), node))).toBe('shallow');
  });

  it('stops at the node limit', () => {
    const many = Array.from({ length: MAX_NODES + 10 }, (_, i) => p(t(`w${i}`)));
    const lines = adfToText(doc(...many))!.split('\n');
    expect(lines.length).toBeLessThan(MAX_NODES);
    expect(lines[0]).toBe('w0');
  });

  it('caps the text length', () => {
    const text = adfToText(doc(p(t('a'.repeat(MAX_TEXT_CHARS + 100))), p(t('after'))));
    expect(text).toHaveLength(MAX_TEXT_CHARS);
  });
});
