// Minimal RingCentral REST API client: JWT auth + paginated GET helper.
// No RingCentral SDK dependency — just fetch, so this runs standalone in CI.

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function rcConfig() {
  return {
    serverUrl: process.env.RC_SERVER_URL || 'https://platform.ringcentral.com',
    clientId: requireEnv('RC_CLIENT_ID'),
    clientSecret: requireEnv('RC_CLIENT_SECRET'),
    jwt: requireEnv('RC_JWT'),
  }
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
