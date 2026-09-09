// Token Vault — local-only credential store.
// Encryption: AES-256-GCM via SubtleCrypto (no external calls).
// Key lives in IndexedDB; encrypted payload in chrome.storage.local.
// Nothing is ever sent to a server.

export interface VaultCredentials {
  name: string
  email: string
  phone: string
  // password stored only when the user explicitly opts in
  password?: string
  googleLinked: boolean
  savedAt: number
}

// ─── IndexedDB key store ───────────────────────────────────────────────────

const IDB_NAME = 'sentinel-keystore'
const IDB_STORE = 'keys'
const KEY_ID = 'vault-aes-key'

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(KEY_ID)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function setKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const req = tx.objectStore(IDB_STORE).put(key, KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ─── Chrome storage helpers ────────────────────────────────────────────────

const STORAGE_KEY = 'sentinel_vault_payload'
const FLAG_KEY = 'sentinel_vault_initialized'

async function chromeGet(key: string): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.storage) return null
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => resolve(result[key] ?? null))
  })
}

async function chromeSet(key: string, value: unknown): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value }, () => resolve())
  })
}

async function chromeRemove(key: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return
  return new Promise(resolve => {
    chrome.storage.local.remove([key], () => resolve())
  })
}

// ─── Crypto helpers ────────────────────────────────────────────────────────

async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await openKeyStore()
  const existing = await getKey(db)
  if (existing) return existing

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — stays in the browser
    ['encrypt', 'decrypt'],
  )
  await setKey(db, key)
  return key
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    ct: Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join(''),
  }
}

async function decrypt(key: CryptoKey, iv: string, ct: string): Promise<string> {
  const ivBuf = new Uint8Array(iv.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const ctBuf = new Uint8Array(ct.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, key, ctBuf)
  return new TextDecoder().decode(plain)
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function hasVaultCredentials(): Promise<boolean> {
  const flag = await chromeGet(FLAG_KEY)
  return flag === true
}

export async function saveVaultCredentials(creds: VaultCredentials): Promise<void> {
  const key = await getOrCreateKey()
  const payload = await encrypt(key, JSON.stringify(creds))
  await chromeSet(STORAGE_KEY, payload)
  await chromeSet(FLAG_KEY, true)
}

export async function loadVaultCredentials(): Promise<VaultCredentials | null> {
  const flag = await chromeGet(FLAG_KEY)
  if (!flag) return null

  const payload = await chromeGet(STORAGE_KEY) as { iv: string; ct: string } | null
  if (!payload) return null

  try {
    const key = await getOrCreateKey()
    const json = await decrypt(key, payload.iv, payload.ct)
    return JSON.parse(json) as VaultCredentials
  } catch {
    return null
  }
}

export async function clearVaultCredentials(): Promise<void> {
  await chromeRemove(STORAGE_KEY)
  await chromeRemove(FLAG_KEY)
}

// Match a fill action description to a vault field.
// Returns the stored value or null if no match.
export function matchVaultField(description: string, creds: VaultCredentials): string | null {
  const d = description.toLowerCase()
  if (/email|mail/.test(d)) return creds.email || null
  if (/phone|mobile|number/.test(d)) return creds.phone || null
  if (/name/.test(d) && !/user/.test(d)) return creds.name || null
  if (/password|passwd|pwd/.test(d)) return creds.password ?? null
  return null
}
