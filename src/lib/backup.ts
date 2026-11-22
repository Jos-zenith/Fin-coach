import type { Snapshot } from './db'

/**
 * Export file format. With a passphrase, the snapshot is encrypted with AES-GCM using a key derived
 * by PBKDF2 (SHA-256, 250k iterations). Only the export file is encrypted; the browser database is not.
 */
interface EncryptedFile {
  app: 'runway'
  encrypted: true
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  data: string
}

const ITERATIONS = 250_000
const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
  let bin = ''
  // chunked so large exports don't overflow the call stack
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(pass: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encodeExport(s: Snapshot, passphrase: string): Promise<string> {
  const json = JSON.stringify(s)
  if (!passphrase) return json
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json))
  const file: EncryptedFile = {
    app: 'runway',
    encrypted: true,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
  }
  return JSON.stringify(file)
}

export function isEncrypted(text: string): boolean {
  try {
    return (JSON.parse(text) as Partial<EncryptedFile>).encrypted === true
  } catch {
    return false
  }
}

export async function decodeExport(text: string, passphrase: string): Promise<Snapshot> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const f = parsed as Partial<EncryptedFile>
  if (f.encrypted) {
    if (!passphrase) throw new Error('This export is encrypted. Enter its passphrase.')
    const key = await deriveKey(passphrase, fromB64(f.salt!), f.iterations ?? ITERATIONS)
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.iv!) as BufferSource }, key, fromB64(f.data!) as BufferSource)
      return JSON.parse(dec.decode(plain)) as Snapshot
    } catch {
      throw new Error('Wrong passphrase, or the file is damaged.')
    }
  }
  return parsed as Snapshot
}

export function download(name: string, text: string) {
  const type = name.endsWith('.md') ? 'text/markdown' : 'application/json'
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
