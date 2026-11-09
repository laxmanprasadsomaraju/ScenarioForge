import { describe, expect, it } from 'vitest';
import { buildRecentChangesJql, parseListChangesRequest } from '../src/validation';

describe('parseListChangesRequest', () => {
  it('applies defaults for an empty payload', () => {
    expect(parseListChangesRequest(undefined)).toEqual({
      ok: true,
      value: { updatedWithin: '30d', maxResults: 25 },
    });
    expect(parseListChangesRequest({})).toEqual({
      ok: true,
      value: { updatedWithin: '30d', maxResults: 25 },
    });
  });

  it('accepts valid values', () => {
    expect(parseListChangesRequest({ updatedWithin: '365d', maxResults: 50 })).toEqual({
      ok: true,
      value: { updatedWithin: '365d', maxResults: 50 },
    });
  });

  it.each([
    ['array payload', []],
    ['string payload', 'updated >= -1d'],
    ['JQL injection in window', { updatedWithin: '30d OR project = SECRET' }],
    ['unknown window', { updatedWithin: '1y' }],
    ['zero results', { maxResults: 0 }],
    ['too many results', { maxResults: 51 }],
    ['fractional results', { maxResults: 2.5 }],
    ['string results', { maxResults: '10' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseListChangesRequest(payload).ok).toBe(false);
  });
});

describe('buildRecentChangesJql', () => {
  it('builds a bounded, ordered query', () => {
    expect(buildRecentChangesJql('7d')).toBe('updated >= -7d ORDER BY updated DESC');
  });
});
