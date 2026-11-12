import { describe, expect, it } from 'vitest';
import { participantAlias } from '../src/crisis/resolvers';

describe('crisis participant ids', () => {
  it('are opaque, stable in a room and different in another room', () => {
    const a = participantAlias({ aliasKey: 'secret-a' } as never, 'inst', 'room1');
    const b = participantAlias({ aliasKey: 'secret-b' } as never, 'inst', 'room2');
    const id = a('712020:abc-def');
    expect(id).toMatch(/^p_[A-Za-z0-9_-]{16}$/);
    expect(id).not.toContain('712020');
    expect(a('712020:abc-def')).toBe(id);
    expect(b('712020:abc-def')).not.toBe(id);
  });
});
