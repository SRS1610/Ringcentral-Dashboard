import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'

export interface RcConnectionConfig {
  clientId: string
  serverUrl: string
}

export interface RcTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
}

const CONFIG_KEY = 'rc_dashboard_connection_config'
const TOKENS_KEY = 'rc_dashboard_tokens'
const PENDING_KEY = 'rc_dashboard_oauth_pending'

export const RC_SERVER_URLS = {
  production: 'https://platform.ringcentral.com',
  sandbox: 'https://platform.devtest.ringcentral.com',
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

export function loadConnectionConfig(): RcConnectionConfig | null {
  const raw = safeGet(CONFIG_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveConnectionConfig(config: RcConnectionConfig): void {
  safeSet(CONFIG_KEY, JSON.stringify(config))
}

export function loadTokens(): RcTokens | null {
  const raw = safeGet(TOKENS_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveTokens(tokens: RcTokens): void {
  safeSet(TOKENS_KEY, JSON.stringify(tokens))
}

export function clearConnection(): void {
  safeRemove(TOKENS_KEY)
  safeRemove(PENDING_KEY)
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

/** Returns a valid access token, refreshing it first if it's expired or close to it. */
export async function getValidAccessToken(): Promise<string> {
  const config = loadConnectionConfig()
  const tokens = loadTokens()
  if (!config || !tokens) throw new Error('Not connected to RingCentral.')

  if (tokens.expiresAt - Date.now() > 60_000) {
    return tokens.accessToken
  }

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

export function isConnected(): boolean {
  return loadConnectionConfig() !== null && loadTokens() !== null
}
