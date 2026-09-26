import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'
import type { RcJwtCredentials } from './ringcentralCredentials'

export interface RcConnectionConfig {
  clientId: string
  serverUrl: string
}

export interface RcTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
}

export type ConnectionMode = 'pkce' | 'jwt'

const CONFIG_KEY = 'rc_dashboard_connection_config'
const TOKENS_KEY = 'rc_dashboard_tokens'
const PENDING_KEY = 'rc_dashboard_oauth_pending'
const JWT_CREDS_KEY = 'rc_dashboard_jwt_credentials'
const REMEMBERED_APP_KEY = 'rc_dashboard_app_client'

export const RC_SERVER_URLS = {
  production: 'https://platform.ringcentral.com',
  sandbox: 'https://platform.devtest.ringcentral.com',
}

// ---- Which RingCentral app "Sign in with RingCentral" uses --------------------
// A PKCE app's Client ID is public (it ships in every browser that signs in), so it
// can live in the site itself (public/ringcentral-app.json) or be entered once in
// Settings and remembered per browser.

export interface RcAppConfig extends RcConnectionConfig {
  source: 'site' | 'browser'
}

export async function loadSiteAppConfig(): Promise<RcAppConfig | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}ringcentral-app.json`, { cache: 'no-cache' })
    if (!res.ok) return null
    const data = (await res.json()) as { clientId?: string; environment?: string }
    const clientId = data.clientId?.trim()
    if (!clientId) return null
    const serverUrl = data.environment === 'sandbox' ? RC_SERVER_URLS.sandbox : RC_SERVER_URLS.production
    return { clientId, serverUrl, source: 'site' }
  } catch {
    return null
  }
}

export function loadRememberedApp(): RcAppConfig | null {
  const stored = readJson<RcConnectionConfig>(REMEMBERED_APP_KEY)
  return stored?.clientId ? { ...stored, source: 'browser' } : null
}

export function rememberApp(config: RcConnectionConfig): void {
  safeSet(REMEMBERED_APP_KEY, JSON.stringify({ clientId: config.clientId, serverUrl: config.serverUrl }))
}

export function forgetRememberedApp(): void {
  safeRemove(REMEMBERED_APP_KEY)
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore (private browsing / storage disabled) — connection just won't persist
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function readJson<T>(key: string): T | null {
  const raw = safeGet(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---- JWT credentials-file mode ---------------------------------------------
// Credentials live in memory for the tab's lifetime; they are only written to
// localStorage when the user explicitly opts in ("remember on this browser").
// The short-lived access token is never persisted.

let jwtCredentials: RcJwtCredentials | null = null
let jwtAccessToken: { accessToken: string; expiresAt: number } | null = null

export function setJwtCredentials(creds: RcJwtCredentials, remember: boolean): void {
  jwtCredentials = creds
  jwtAccessToken = null
  if (remember) safeSet(JWT_CREDS_KEY, JSON.stringify(creds))
  else safeRemove(JWT_CREDS_KEY)
}

export function loadJwtCredentials(): RcJwtCredentials | null {
  if (jwtCredentials) return jwtCredentials
  const stored = readJson<RcJwtCredentials>(JWT_CREDS_KEY)
  if (stored) jwtCredentials = stored
  return jwtCredentials
}

export function jwtCredentialsRemembered(): boolean {
  return safeGet(JWT_CREDS_KEY) !== null
}

function clearJwtCredentials(): void {
  jwtCredentials = null
  jwtAccessToken = null
  safeRemove(JWT_CREDS_KEY)
}

async function fetchJwtAccessToken(creds: RcJwtCredentials): Promise<string> {
  const basic = btoa(`${creds.clientId}:${creds.clientSecret}`)
  let res: Response
  try {
    res = await fetch(`${creds.serverUrl}/restapi/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: creds.jwt,
      }),
    })
  } catch (e) {
    throw new Error(
      `Couldn't reach RingCentral from the browser (${e instanceof Error ? e.message : 'network error'}). ` +
        'If this keeps happening, the scheduled GitHub Actions sync (see README) does the same import server-side.',
    )
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `RingCentral rejected the credentials (${res.status}): ${body}. ` +
        'Check that the app has the JWT auth flow enabled and the JWT was issued for it.',
    )
  }
  const data = await res.json()
  jwtAccessToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return jwtAccessToken.accessToken
}

// ---- PKCE sign-in mode ------------------------------------------------------

export function loadPkceConfig(): RcConnectionConfig | null {
  return readJson<RcConnectionConfig>(CONFIG_KEY)
}

export function saveConnectionConfig(config: RcConnectionConfig): void {
  safeSet(CONFIG_KEY, JSON.stringify(config))
}

export function loadTokens(): RcTokens | null {
  return readJson<RcTokens>(TOKENS_KEY)
}

function saveTokens(tokens: RcTokens): void {
  safeSet(TOKENS_KEY, JSON.stringify(tokens))
}

function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export function redirectUriForDisplay(): string {
  return redirectUri()
}

/** Kicks off the PKCE authorization-code flow by navigating to RingCentral's login page. */
export async function beginConnect(config: RcConnectionConfig): Promise<void> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()
  safeSet(PENDING_KEY, JSON.stringify({ verifier, state, config }))

  const url = new URL(`${config.serverUrl}/restapi/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  window.location.assign(url.toString())
}

/**
 * Call on every app load. If the URL carries an OAuth redirect (`code`/`state`
 * or `error`), completes or reports it and strips the query string. Returns
 * null when there was nothing to handle.
 */
export async function completePendingConnect(): Promise<{ ok: true } | { ok: false; error: string } | null> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (!code && !error) return null

  const pendingRaw = safeGet(PENDING_KEY)
  safeRemove(PENDING_KEY)
  window.history.replaceState({}, '', window.location.pathname)

  if (error) {
    return { ok: false, error: params.get('error_description') || error }
  }
  if (!pendingRaw) {
    return { ok: false, error: 'No pending connection request found (was this tab reloaded mid-flow?).' }
  }
  const pending = JSON.parse(pendingRaw) as { verifier: string; state: string; config: RcConnectionConfig }
  if (state !== pending.state) {
    return { ok: false, error: 'State mismatch — possible CSRF or stale request. Please try connecting again.' }
  }

  try {
    const res = await fetch(`${pending.config.serverUrl}/restapi/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: redirectUri(),
        client_id: pending.config.clientId,
        code_verifier: pending.verifier,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `Token exchange failed (${res.status}): ${body}` }
    }
    const data = await res.json()
    clearJwtCredentials()
    saveConnectionConfig(pending.config)
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Token exchange failed' }
  }
}

async function refreshPkceToken(config: RcConnectionConfig, tokens: RcTokens): Promise<string> {
  const res = await fetch(`${config.serverUrl}/restapi/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
    }),
  })
  if (!res.ok) {
    clearConnection()
    throw new Error(`Session expired and refresh failed (${res.status}). Please reconnect.`)
  }
  const data = await res.json()
  const next: RcTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  saveTokens(next)
  return next.accessToken
}

// ---- Mode-agnostic surface ---------------------------------------------------

export function getConnectionMode(): ConnectionMode | null {
  if (loadJwtCredentials()) return 'jwt'
  if (loadPkceConfig() && loadTokens()) return 'pkce'
  return null
}

export function loadConnectionConfig(): RcConnectionConfig | null {
  const jwt = loadJwtCredentials()
  if (jwt) return { clientId: jwt.clientId, serverUrl: jwt.serverUrl }
  return loadPkceConfig()
}

export function isConnected(): boolean {
  return getConnectionMode() !== null
}

export function clearConnection(): void {
  clearJwtCredentials()
  safeRemove(TOKENS_KEY)
  safeRemove(CONFIG_KEY)
  safeRemove(PENDING_KEY)
}

/** Best-effort server-side revoke so a signed-out session can't be reused, then clears local state. */
export async function signOutAndRevoke(): Promise<void> {
  try {
    const jwt = loadJwtCredentials()
    if (jwt && jwtAccessToken) {
      await fetch(`${jwt.serverUrl}/restapi/oauth/revoke`, {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(`${jwt.clientId}:${jwt.clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: jwtAccessToken.accessToken }),
      })
    } else {
      const config = loadPkceConfig()
      const tokens = loadTokens()
      if (config && tokens) {
        await fetch(`${config.serverUrl}/restapi/oauth/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refreshToken || tokens.accessToken, client_id: config.clientId }),
        })
      }
    }
  } catch {
    // Revocation is a courtesy; local sign-out below must happen regardless.
  }
  clearConnection()
}

/** Returns a valid access token for whichever connection mode is active, refreshing if needed. */
export async function getValidAccessToken(): Promise<string> {
  const jwt = loadJwtCredentials()
  if (jwt) {
    if (jwtAccessToken && jwtAccessToken.expiresAt - Date.now() > 60_000) return jwtAccessToken.accessToken
    return fetchJwtAccessToken(jwt)
  }

  const config = loadPkceConfig()
  const tokens = loadTokens()
  if (!config || !tokens) throw new Error('Not connected to RingCentral.')
  if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken
  return refreshPkceToken(config, tokens)
}
