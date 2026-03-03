const SESSION_KEY = 'flonotes-key'
const PBKDF2_ITERATIONS = 200_000

export async function deriveKey(password: string, email: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(email.toLowerCase().trim()),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can persist to sessionStorage
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), 12)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptText(key: CryptoKey, cipher: string): Promise<string> {
  const combined = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) },
    key,
    combined.slice(12),
  )
  return new TextDecoder().decode(plaintext)
}

export async function saveKeyToSession(key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key)
  sessionStorage.setItem(SESSION_KEY, btoa(String.fromCharCode(...new Uint8Array(raw))))
}

export async function loadKeyFromSession(): Promise<CryptoKey | null> {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (!stored) return null
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))
    return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  } catch {
    return null
  }
}

export function clearKeyFromSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}
