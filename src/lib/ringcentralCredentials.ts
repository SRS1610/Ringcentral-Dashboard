export interface RcJwtCredentials {
  clientId: string
  clientSecret: string
  jwt: string
  serverUrl: string
}

// RingCentral's console exports credentials under varying key names; mirror the
// aliases the CI sync script (scripts/lib/rc-client.mjs) accepts.
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

export function parseCredentialsJson(text: string, defaultServerUrl: string): RcJwtCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON. It should be the credentials file downloaded from the RingCentral Developer Console.")
  }
  const flat = flatten(parsed)
  const clientId = findKey(flat, KEY_ALIASES.clientId)
  const clientSecret = findKey(flat, KEY_ALIASES.clientSecret)
  const jwt = findKey(flat, KEY_ALIASES.jwt)
  const serverUrl = findKey(flat, KEY_ALIASES.serverUrl) ?? defaultServerUrl

  const missing = (['clientId', 'clientSecret', 'jwt'] as const).filter((k) => !{ clientId, clientSecret, jwt }[k])
  if (missing.length > 0) {
    // Names only, never values — this message may be pasted into a chat for help.
    const present = Object.keys(flat).join(', ') || '(none)'
    throw new Error(`Couldn't find ${missing.join(', ')} in that file. Keys found: ${present}.`)
  }
  return { clientId: clientId!, clientSecret: clientSecret!, jwt: jwt!, serverUrl }
}
