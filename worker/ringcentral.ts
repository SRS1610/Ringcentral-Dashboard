// Server-side RingCentral access for the dashboard Worker: reads the JWT app
// credentials from Worker secrets, exchanges the JWT for an access token, and
// calls the REST API. Nothing here is ever sent to the browser in the clear.

export interface Env {
  ASSETS: Fetcher
  /** The whole credentials JSON from the RingCentral Developer Console (JWT-flow app)… */
  RC_CREDENTIALS_JSON?: string
  /** …or the three values as separate secrets. */
  RC_CLIENT_ID?: string
  RC_CLIENT_SECRET?: string
  RC_JWT?: string
  /** Defaults to production; set to https://platform.devtest.ringcentral.com for a sandbox account. */
  RC_SERVER_URL?: string
  /** Shared password viewers enter once to unlock the live data. */
  DASHBOARD_PASSWORD?: string
  /** Set to "none" only when something else (e.g. Cloudflare Access) already protects the site. */
  DASHBOARD_AUTH?: string
}

export interface RcCredentials {
  serverUrl: string
  clientId: string
  clientSecret: string
  jwt: string
}

/** A failure the API layer turns into a JSON error response with this status. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter?: number
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

// Key names in the console's credentials file vary between versions; these mirror
// the spellings the scheduled sync (scripts/lib/rc-client.mjs) accepts.
const KEY_ALIASES = {
  clientId: ['clientId', 'client_id', 'clientID', 'appKey', 'app_key'],
  clientSecret: ['clientSecret', 'client_secret', 'appSecret', 'app_secret'],
  jwt: ['jwt', 'jwtToken', 'jwt_token', 'assertion', 'token', 'jwtCredential'],
  serverUrl: ['serverUrl', 'server_url', 'server', 'platformUrl', 'apiUrl'],
} as const

type Flat = Record<string, unknown>

function flatten(value: unknown, out: Flat = {}): Flat {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, out)
      else if (out[key] === undefined) out[key] = child
    }
  }
  return out
}

function findKey(flat: Flat, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const v = flat[alias]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return undefined
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export function readCredentials(env: Env): RcCredentials {
  let fromJson: Partial<RcCredentials> = {}
  const raw = clean(env.RC_CREDENTIALS_JSON)
  if (raw) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ApiError(503, 'not_configured', 'The RC_CREDENTIALS_JSON secret is not valid JSON. Paste the whole credentials file from the RingCentral Developer Console.')
    }
    const flat = flatten(parsed)
    fromJson = {
      clientId: findKey(flat, KEY_ALIASES.clientId),
      clientSecret: findKey(flat, KEY_ALIASES.clientSecret),
      jwt: findKey(flat, KEY_ALIASES.jwt),
      serverUrl: findKey(flat, KEY_ALIASES.serverUrl),
    }
  }

  const clientId = clean(env.RC_CLIENT_ID) ?? fromJson.clientId
  const clientSecret = clean(env.RC_CLIENT_SECRET) ?? fromJson.clientSecret
  const jwt = clean(env.RC_JWT) ?? fromJson.jwt
  const serverUrl = (clean(env.RC_SERVER_URL) ?? fromJson.serverUrl ?? 'https://platform.ringcentral.com').replace(/\/+$/, '')

  const missing = [
    ['RC_CLIENT_ID', clientId],
    ['RC_CLIENT_SECRET', clientSecret],
    ['RC_JWT', jwt],
  ]
    .filter(([, v]) => !v)
    .map(([name]) => name)
  if (missing.length > 0) {
    // Names only, never values.
    throw new ApiError(
      503,
      'not_configured',
      `The Worker is missing RingCentral credentials (${missing.join(', ')}). Add the secret RC_CREDENTIALS_JSON (the whole credentials file) or RC_CLIENT_ID, RC_CLIENT_SECRET and RC_JWT.`,
    )
  }
  return { serverUrl, clientId: clientId!, clientSecret: clientSecret!, jwt: jwt! }
}

// ---- Access token ------------------------------------------------------------
// RingCentral allows only a handful of token requests per minute, and a Worker
// isolate can be recycled at any time. So besides the in-memory copy, the token is
// handed to the browser as an encrypted blob ("session") that only this Worker's
// secrets can open, and the browser sends it back on later requests. The browser
// never sees the token itself.

interface Token {
  accessToken: string
  expiresAt: number // epoch ms
}

const EXPIRY_MARGIN_MS = 60_000
export const SESSION_HEADER = 'X-RC-Session'

let memo: { fingerprint: string; token: Token } | null = null

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const fingerprintOf = (c: RcCredentials) => `${c.serverUrl}|${c.clientId}|${c.jwt.slice(-24)}`
const stillValid = (t: Token) => t.expiresAt - Date.now() > EXPIRY_MARGIN_MS

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function sessionKey(creds: RcCredentials): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`rc-dashboard-session|${creds.clientSecret}|${creds.jwt}`))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function sealToken(creds: RcCredentials, token: Token): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = encoder.encode(JSON.stringify({ t: token.accessToken, e: token.expiresAt }))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(creds), plain))
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv)
  out.set(cipher, iv.length)
  return toBase64Url(out)
}

async function openToken(creds: RcCredentials, blob: string | null): Promise<Token | null> {
  if (!blob || blob.length > 8192) return null
  try {
    const bytes = fromBase64Url(blob)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await sessionKey(creds), bytes.slice(12))
    const data = JSON.parse(decoder.decode(plain)) as { t?: unknown; e?: unknown }
    if (typeof data.t !== 'string' || typeof data.e !== 'number') return null
    return { accessToken: data.t, expiresAt: data.e }
  } catch {
    return null // tampered, or sealed with credentials that have since been rotated
  }
}

async function exchangeJwt(creds: RcCredentials): Promise<Token> {
  let res: Response
  try {
    res = await fetch(`${creds.serverUrl}/restapi/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: creds.jwt }),
    })
  } catch (e) {
    throw new ApiError(502, 'ringcentral_unreachable', `Couldn't reach RingCentral (${e instanceof Error ? e.message : 'network error'}).`)
  }
  if (res.status === 429) throw rateLimited(res)
  if (!res.ok) {
    throw new ApiError(
      502,
      'ringcentral_auth',
      `RingCentral rejected the Worker's JWT credentials (${res.status}): ${await describeError(res)}. ` +
        'Check that the app uses the JWT auth flow, that the JWT was issued for this app, and that the secrets match the environment (production vs sandbox).',
    )
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
}

function rateLimited(res: Response): ApiError {
  const header = Number(res.headers.get('Retry-After'))
  const retryAfter = Number.isFinite(header) && header > 0 ? Math.min(Math.ceil(header), 120) : 60
  return new ApiError(429, 'rate_limited', 'RingCentral rate limit reached.', retryAfter)
}

async function describeError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const data = JSON.parse(text) as { message?: string; error_description?: string; errorCode?: string; error?: string }
    const detail = data.message ?? data.error_description ?? data.error
    if (detail) return data.errorCode ? `${data.errorCode}: ${detail}` : detail
  } catch {
    // not JSON — fall through to the raw body
  }
  return text.slice(0, 300) || res.statusText
}

/** One request's view of RingCentral: credentials, a usable token, and whether to hand the browser a new session blob. */
export class RcSession {
  readonly creds: RcCredentials
  private token: Token
  /** Set when the browser's blob was missing or stale and should be replaced. */
  private reissue: boolean

  private constructor(creds: RcCredentials, token: Token, reissue: boolean) {
    this.creds = creds
    this.token = token
    this.reissue = reissue
  }

  static async open(env: Env, request: Request): Promise<RcSession> {
    const creds = readCredentials(env)
    const fingerprint = fingerprintOf(creds)
    const fromBrowser = await openToken(creds, request.headers.get(SESSION_HEADER))

    if (fromBrowser && stillValid(fromBrowser)) {
      // Prefer whichever copy lasts longer, so one viewer's fresh token benefits the isolate.
      if (!memo || memo.fingerprint !== fingerprint || memo.token.expiresAt < fromBrowser.expiresAt) memo = { fingerprint, token: fromBrowser }
      return new RcSession(creds, fromBrowser, false)
    }
    if (memo && memo.fingerprint === fingerprint && stillValid(memo.token)) return new RcSession(creds, memo.token, true)

    const token = await exchangeJwt(creds)
    memo = { fingerprint, token }
    return new RcSession(creds, token, true)
  }

  /** Header to attach to the response when the browser needs a new session blob. */
  async sessionHeader(): Promise<Record<string, string>> {
    return this.reissue ? { [SESSION_HEADER]: await sealToken(this.creds, this.token) } : {}
  }

  private async refresh(): Promise<void> {
    this.token = await exchangeJwt(this.creds)
    memo = { fingerprint: fingerprintOf(this.creds), token: this.token }
    this.reissue = true
  }

  /** Calls the REST API and returns parsed JSON. Throws ApiError; RingCentral's own status is kept in `upstreamStatus`. */
  async call<T = RcRecord>(path: string, options: { params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${this.creds.serverUrl}${path}`)
    for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value)

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: options.body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${this.token.accessToken}`,
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        })
      } catch (e) {
        throw new ApiError(502, 'ringcentral_unreachable', `Couldn't reach RingCentral (${e instanceof Error ? e.message : 'network error'}).`)
      }
      if (res.ok) return (await res.json()) as T
      if (res.status === 401 && attempt === 0) {
        // Token revoked or expired early: get a new one and try once more.
        await this.refresh()
        continue
      }
      if (res.status === 429) throw rateLimited(res)
      throw new RcUpstreamError(res.status, `RingCentral ${url.pathname} failed (${res.status}): ${await describeError(res)}`)
    }
  }
}

/** RingCentral answered with an error; `upstreamStatus` is its HTTP status (403 = the JWT's user lacks permission). */
export class RcUpstreamError extends ApiError {
  readonly upstreamStatus: number
  constructor(upstreamStatus: number, message: string) {
    super(upstreamStatus === 403 ? 403 : 502, upstreamStatus === 403 ? 'ringcentral_forbidden' : 'ringcentral_error', message)
    this.upstreamStatus = upstreamStatus
  }
}

export const isForbidden = (e: unknown): boolean => e instanceof RcUpstreamError && e.upstreamStatus === 403

// RingCentral's responses are wider than what the dashboard uses; `any` keeps the
// field access in the mappers terse instead of hand-typing the full API shape.
// oxlint-disable-next-line no-explicit-any
export type RcRecord = Record<string, any>

/** For tests: forget the in-memory token. */
export function resetTokenMemo(): void {
  memo = null
}
