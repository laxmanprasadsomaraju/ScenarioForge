import { sha256Bytes } from '../../../../shared/remediation/sha256';

// DEV PREVIEW ONLY (vite.config.ts aliases `node:crypto` to this file when
// SF_PREVIEW=1 on the dev server). The Crisis room preview runs the real
// resolvers in the browser, and they call `createHmac`. This is a real
// HMAC-SHA-256 over the repo's pure SHA-256, so participant ids in the
// preview are derived the same way as on the server. Never part of a Forge build.

const BLOCK = 64;

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const k = new Uint8Array(BLOCK);
  k.set(key.length > BLOCK ? sha256Bytes(key) : key);
  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i++) {
    inner[i] = k[i]! ^ 0x36;
    outer[i] = k[i]! ^ 0x5c;
  }
  inner.set(message, BLOCK);
  outer.set(sha256Bytes(inner), BLOCK);
  return sha256Bytes(outer);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createHmac(algorithm: string, key: string | Uint8Array) {
  if (algorithm !== 'sha256') throw new Error('Preview shim supports sha256 only.');
  let message = new Uint8Array(0);
  const api = {
    update(data: string | Uint8Array) {
      const next = toBytes(data);
      const joined = new Uint8Array(message.length + next.length);
      joined.set(message);
      joined.set(next, message.length);
      message = joined;
      return api;
    },
    digest(encoding: 'base64url') {
      if (encoding !== 'base64url') throw new Error('Preview shim supports base64url only.');
      return base64url(hmacSha256(toBytes(key), message));
    },
  };
  return api;
}

export function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  crypto.getRandomValues(out);
  return out;
}
