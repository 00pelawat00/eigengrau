// Encryption helpers (Web Crypto). All data is encrypted with a random
// 256-bit data key; that key is wrapped by keys derived from the password,
// the recovery key and (optionally) the PIN.
const enc = new TextEncoder();
const dec = new TextDecoder();
export const ITER = 600000;

export function rand(n) { return crypto.getRandomValues(new Uint8Array(n)); }

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

export async function deriveKey(secret, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export function newDataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// Wrap the data key with a secret. Returns a storable object.
export async function wrapWith(dek, secret, iter = ITER) {
  const salt = rand(16), iv = rand(12);
  const kek = await deriveKey(secret, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter };
}

// Throws if the secret is wrong.
export async function unwrapWith(obj, secret) {
  const kek = await deriveKey(secret, unb64(obj.salt), obj.iter || ITER);
  return crypto.subtle.unwrapKey('raw', unb64(obj.ct), kek, { name: 'AES-GCM', iv: unb64(obj.iv) },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptJSON(dek, obj) {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(obj))));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(dek, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, dek, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}

// Recovery key: 20 random bytes as base32, grouped in fours.
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export function newRecoveryKey() {
  const bytes = rand(20);
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-');
}
export function normRecovery(s) { return s.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') || ''; }
