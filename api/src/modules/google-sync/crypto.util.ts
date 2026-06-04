import {
  createCipheriv, createDecipheriv, randomBytes,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;        // 96-bit IV — the GCM-recommended length
const KEY_BYTES = 32;       // 256-bit key

// Fallback dev key (32 bytes hex = 64 chars). In production GOOGLE_TOKEN_ENC_KEY
// MUST be set to a real random value via env — see docker-compose.yml.
const DEV_KEY_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function loadKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY?.trim();
  if (!raw && process.env.NODE_ENV === 'production') {
    throw new Error(
      'GOOGLE_TOKEN_ENC_KEY must be set in production. ' +
        `Generate one with: openssl rand -hex ${KEY_BYTES}`,
    );
  }
  const hex = raw || DEV_KEY_HEX;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `GOOGLE_TOKEN_ENC_KEY must be ${KEY_BYTES * 2} hex chars (${KEY_BYTES} bytes); got ${buf.length}`,
    );
  }
  return buf;
}

export interface SealedSecret {
  ciphertext: string;   // base64
  iv: string;           // base64
  tag: string;          // base64
}

export function encrypt(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decrypt(sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGO, loadKey(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}
