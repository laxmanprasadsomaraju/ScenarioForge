import { createHmac as nodeHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHmac as shimHmac } from '../static/app/src/dev/nodeCryptoShim';

// The dev-preview shim stands in for node:crypto in the browser. It must give
// the same participant ids the server derives, or the preview would mislead.
describe('dev preview node:crypto shim', () => {
  const keys = ['k', 'legacy:inst:room', 'x'.repeat(64), 'y'.repeat(65), 'z'.repeat(200), 'ké'];
  const messages = ['', 'a', 'account-123', 'm'.repeat(55), 'm'.repeat(64), 'ünï'];

  it('matches node HMAC-SHA-256 base64url for short, block-size and long keys', () => {
    for (const k of keys) {
      for (const m of messages) {
        expect(shimHmac('sha256', k).update(m).digest('base64url')).toBe(
          nodeHmac('sha256', k).update(m).digest('base64url'),
        );
      }
    }
  });
});
