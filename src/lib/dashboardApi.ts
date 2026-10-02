// Client for the dashboard's own backend: the /api/ routes served by the Cloudflare
// Worker (worker/index.ts). The Worker signs in to RingCentral with credentials held
// in its secrets; the browser only ever holds the dashboard password and an opaque,
// encrypted session blob it can't read.

const PASSWORD_KEY = 'rc_dashboard_password'
const SESSION_HEADER = 'X-RC-Session'
const MAX_RATE_LIMIT_RETRIES = 3

export type StatusCallback = (message: string) => void

/** `code` is the Worker's error code, or `no_backend` when this host has no Worker behind it. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ---- Dashboard password -------------------------------------------------------
// Kept for the tab's lifetime; written to localStorage only when the viewer asks
// for it to be remembered on this browser.

let password: string | null = null
let session: string | null = null

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage
  } catch {
    return null // storage disabled — the password just won't persist
  }
}

export function loadPassword(): string | null {
  if (password) return password
  try {
    password = storage('session')?.getItem(PASSWORD_KEY) ?? storage('local')?.getItem(PASSWORD_KEY) ?? null
  } catch {
    password = null
  }
  return password
}

export function passwordRemembered(): boolean {
  try {
    return storage('local')?.getItem(PASSWORD_KEY) != null
  } catch {
    return false
  }
}

export function setPassword(value: string, remember: boolean): void {
  password = value
  try {
    storage('session')?.setItem(PASSWORD_KEY, value)
    if (remember) storage('local')?.setItem(PASSWORD_KEY, value)
    else storage('local')?.removeItem(PASSWORD_KEY)
  } catch {
    // ignore — held in memory only
  }
}

export function clearPassword(): void {
  password = null
  session = null
  try {
    storage('session')?.removeItem(PASSWORD_KEY)
    storage('local')?.removeItem(PASSWORD_KEY)
  } catch {
    // ignore
  }
}

// ---- Requests -----------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function apiGet<T>(route: string, params: Record<string, string> = {}, onStatus?: StatusCallback): Promise<T> {
  const url = new URL(`${import.meta.env.BASE_URL}api/${route}`, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const pw = loadPassword()
    if (pw) headers.Authorization = `Bearer ${pw}`
    if (session) headers[SESSION_HEADER] = session

    let res: Response
    try {
      res = await fetch(url, { headers, cache: 'no-store' })
    } catch (e) {
      throw new ApiError(`Couldn't reach the dashboard server (${e instanceof Error ? e.message : 'network error'}).`, 0, 'network')
    }

    // A static host (GitHub Pages, Netlify, `vite dev`) has no Worker: it answers with a 404 or the site's HTML.
    const isJson = (res.headers.get('Content-Type') ?? '').includes('application/json')
    if (!isJson) {
      throw new ApiError('Live RingCentral data needs the Cloudflare Worker deployment; this copy of the site has no server behind it.', res.status, 'no_backend')
    }

    const nextSession = res.headers.get(SESSION_HEADER)
    if (nextSession) session = nextSession

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const header = Number(res.headers.get('Retry-After'))
      const waitSec = Number.isFinite(header) && header > 0 ? Math.min(header, 120) : 60
      onStatus?.(`RingCentral rate limit reached — waiting ${waitSec}s before continuing…`)
      await sleep(waitSec * 1000)
      continue
    }

    const data = (await res.json()) as T & { error?: string; message?: string }
    if (!res.ok) throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status, data.error ?? 'error')
    return data
  }
}
