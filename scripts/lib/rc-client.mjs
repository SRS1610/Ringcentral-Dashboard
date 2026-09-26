// Minimal RingCentral REST API client: JWT auth + paginated GET helper.
// No RingCentral SDK dependency — just fetch, so this runs standalone in CI.

// Credentials come either from RC_CREDENTIALS_JSON (the whole credentials file
// RingCentral's console hands out, pasted as one secret) or from the three
// individual RC_CLIENT_ID / RC_CLIENT_SECRET / RC_JWT variables. Key names in
// the JSON vary between console versions, so several spellings are accepted.
const KEY_ALIASES = {
  clientId: ['clientId', 'client_id', 'clientID', 'appKey', 'app_key'],
  clientSecret: ['clientSecret', 'client_secret', 'appSecret', 'app_secret'],
  jwt: ['jwt', 'jwtToken', 'jwt_token', 'assertion', 'token', 'jwtCredential'],
  serverUrl: ['serverUrl', 'server_url', 'server', 'platformUrl', 'apiUrl'],
}

function findKey(obj, aliases) {
  for (const alias of aliases) {
    if (obj[alias] !== undefined && obj[alias] !== null && String(obj[alias]).trim() !== '') return String(obj[alias]).trim()
  }
  return undefined
}

function flatten(obj, out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, out)
    else if (out[key] === undefined) out[key] = value
  }
  return out
}

function fromCredentialsJson(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`RC_CREDENTIALS_JSON is not valid JSON: ${e.message}`)
  }
  const flat = flatten(parsed)
  const found = {
    clientId: findKey(flat, KEY_ALIASES.clientId),
    clientSecret: findKey(flat, KEY_ALIASES.clientSecret),
    jwt: findKey(flat, KEY_ALIASES.jwt),
    serverUrl: findKey(flat, KEY_ALIASES.serverUrl),
  }
  const missing = ['clientId', 'clientSecret', 'jwt'].filter((k) => !found[k])
  if (missing.length > 0) {
    // Print key names only (never values) so the failing log shows the file's shape.
    throw new Error(
      `RC_CREDENTIALS_JSON is missing ${missing.join(', ')}. ` +
        `Keys present in the file: ${Object.keys(flat).join(', ') || '(none)'}. ` +
        `Accepted spellings: ${missing.map((k) => `${k} -> ${KEY_ALIASES[k].join('|')}`).join('; ')}`,
    )
  }
  return found
}

export function rcConfig() {
  const json = process.env.RC_CREDENTIALS_JSON
  const fromJson = json && json.trim() ? fromCredentialsJson(json) : {}

  const clientId = process.env.RC_CLIENT_ID || fromJson.clientId
  const clientSecret = process.env.RC_CLIENT_SECRET || fromJson.clientSecret
  const jwt = process.env.RC_JWT || fromJson.jwt
  const serverUrl = process.env.RC_SERVER_URL || fromJson.serverUrl || 'https://platform.ringcentral.com'

  const missing = [
    ['RC_CLIENT_ID', clientId],
    ['RC_CLIENT_SECRET', clientSecret],
    ['RC_JWT', jwt],
  ]
    .filter(([, v]) => !v)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `Missing RingCentral credentials: ${missing.join(', ')}. ` +
        'Add repository secret RC_CREDENTIALS_JSON (whole credentials file) or the individual RC_CLIENT_ID / RC_CLIENT_SECRET / RC_JWT secrets.',
    )
  }
  return { serverUrl, clientId, clientSecret, jwt }
}

export async function getAccessToken(config) {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const res = await fetch(`${config.serverUrl}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: config.jwt,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `RingCentral auth failed (${res.status}): ${body}\n` +
        'Check RC_CLIENT_ID / RC_CLIENT_SECRET / RC_JWT, and that the app has the JWT auth flow enabled.',
    )
  }
  const data = await res.json()
  return data.access_token
}

/** GETs every page of a RingCentral list endpoint and concatenates `records`. */
export async function fetchAllPages(config, token, path, params) {
  const records = []
  let page = 1
  for (;;) {
    const url = new URL(`${config.serverUrl}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    url.searchParams.set('perPage', '1000')
    url.searchParams.set('page', String(page))

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GET ${path} failed (${res.status}): ${body}`)
    }
    const data = await res.json()
    const pageRecords = data.records ?? []
    records.push(...pageRecords)
    if (pageRecords.length === 0 || !data.navigation?.nextPage) break
    page += 1
  }
  return records
}
