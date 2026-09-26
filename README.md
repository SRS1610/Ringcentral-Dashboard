# RingCentral Performance Dashboard

An executive-facing dashboard for RingCentral exported data: call activity, service
quality (SLA/abandon rate), and SMS/messaging volume, with department and agent
leaderboards.

Ships with realistic 90-day sample data so it's fully functional out of the box.
Upload your own RingCentral CSV exports via the **Upload data** button to replace
any of the three sample datasets — everything stays in your browser, nothing is
sent to a server.

## Running locally

```bash
npm install
npm run dev
```

Open the printed local URL. `npm run build` produces a static production build in
`dist/`, which can be deployed to any static host (Netlify, GitHub Pages, S3, etc.)
— there is no backend.

## Data sources

The dashboard reads three kinds of RingCentral exports, each independently
replaceable from the "Upload data" panel:

| Dataset | What it is | Sample file |
|---|---|---|
| Call log / call detail | RingCentral Call Log Report CSV, one row per call | `public/data/call-log-sample.csv` |
| Analytics / Quality of Service | RingCentral Analytics Portal export (queue performance, SLA) | `public/data/analytics-qos-sample.csv` |
| SMS / message log | RingCentral message log CSV | `public/data/sms-log-sample.csv` |

Column headers are matched case- and punctuation-insensitively against common
RingCentral export naming (see `src/lib/parsers.ts`), so a genuine export usually
works without any remapping. If your export uses different column names, add them
to the candidate lists in that file.

Sample data is synthetic and generated for illustration only (see the script used
to produce it, not included in the app bundle).

## Live RingCentral sync (optional)

By default the dashboard just reads static CSVs — no backend. You can optionally
wire it up to pull real data from RingCentral on a schedule instead of manual
CSV exports: a GitHub Actions job authenticates to RingCentral, fetches recent
call log + SMS data, and commits it into `public/data/`, which redeploys the
site automatically. The site itself is still 100% static; the "backend" is just
a scheduled CI job, so there's nothing extra to host.

**Setup:**

1. In the [RingCentral Developer Console](https://developers.ringcentral.com/),
   create an app using an admin account, with the **JWT auth flow** enabled
   (this is the flow for unattended/server-to-server access — don't use the
   interactive login flow). Grant it read scopes for call log, messages, and
   extensions/accounts.
2. Generate a JWT credential and note the app's **Client ID**, **Client
   Secret**, and the **JWT token**.
3. In the repo, go to **Settings → Secrets and variables → Actions** and add
   a repository secret named `RC_CREDENTIALS_JSON` whose value is the entire
   contents of the credentials JSON file the RingCentral console gave you —
   the sync reads the client ID, client secret and JWT out of it (several key
   spellings are accepted). Alternatively, add them as three separate secrets:
   `RC_CLIENT_ID`, `RC_CLIENT_SECRET`, `RC_JWT`. If you're testing against a
   RingCentral sandbox account instead of production, also add a repository
   **variable** `RC_SERVER_URL` set to `https://platform.devtest.ringcentral.com`.
4. Edit `scripts/department-map.json` to map your extension numbers to
   department names — RingCentral's API doesn't expose department per call, so
   this mapping fills that gap. Anything not listed shows as "Unassigned".
5. Run the **Sync RingCentral data** workflow once manually (Actions tab →
   select it → Run workflow) to do a first pull and confirm it works, then let
   it run on its schedule (every 6 hours by default — edit the `cron` in
   `.github/workflows/sync-ringcentral.yml` to change it).

**What syncs and what doesn't:** call log and SMS pull live from RingCentral's
REST API. The **Service Quality** tab's data (service level, abandon rate,
average speed of answer) stays upload-only for now — that needs RingCentral's
separate Analytics API, which isn't available on every plan, so it wasn't
wired up speculatively. Once you know what your plan exposes, this can be
added the same way.

Each sync run only re-fetches the last few days (`SYNC_DAYS`, default 7) and
merges it into the existing CSV by record ID, so it's cheap to run often;
records older than `RETENTION_DAYS` (default 120) are dropped to keep the
file size bounded. Both are set as env vars in the workflow if you want to
change them.

This sync only touches the repo's own sample data files. If someone uploads a
CSV through the dashboard's "Upload data" button, that file lives only in
their browser and is never affected by this sync.

## Sign in with RingCentral (Settings tab)

The header shows **Sign in to RingCentral** on every tab. It opens the
Settings tab, whose **Sign in with RingCentral** button sends you to
RingCentral's own login page to enter your RingCentral username and password
(the dashboard never sees the password), then brings you back signed in. It
uses OAuth **Authorization Code + PKCE**, the flow RingCentral provides for
browser apps, so no client secret is involved.

- **After signing in**, your last 30 days of call log and SMS import
  automatically. The header shows `Live · <your name>`. Settings shows who is
  signed in, lets you re-import 7/30/90 days, and has **Sign out** (which also
  revokes the session with RingCentral).
- **Staying signed in**: the session is kept in this browser and data
  re-imports each time the dashboard opens, until you sign out.
- **Admins vs. everyone else**: RingCentral admins get company-wide data.
  Anyone else is shown their own calls and messages, with a note explaining
  why, rather than an error.
- **Rate limits**: if RingCentral answers "too many requests", the import
  waits and retries.

**One-time setup (a RingCentral admin, once):** in the RingCentral Developer
Console create a **new** REST API app. Under Auth choose "3-legged OAuth flow
authorization code", then "Client-side web app" (PKCE, no client secret).
Settings also links to the console's new-app form with these values filled
in. Set the OAuth Redirect URI to the one shown in Settings (for the live site
it's `https://srs1610.github.io/Ringcentral-Dashboard/`), grant Read Accounts,
Read Call Log and Read Messages, and copy the app's **Client ID**. Put that
Client ID in `public/ringcentral-app.json` so everyone just sees the sign-in
button. Or enter it once in Settings, and that browser remembers it. The
Client ID is not a secret, since it's sent to every browser that signs in.

This has to be a different app from the JWT app used by the scheduled sync
and the credentials file. A JWT app has no redirect URI, so RingCentral
rejects browser sign-in with it: "No redirect URI is registered for this
client application" (OAU-113). RingCentral shows that error on its own page
and doesn't send you back. When you return to the dashboard, Settings
explains the fix and lets you enter the new Client ID.

**Alternative: credentials file.** Under "Or use a credentials file instead",
you can pick the same credentials JSON used by the scheduled sync (from a
JWT-flow app) to sign in without RingCentral's login page. By default the
file is held in memory only and forgotten when the tab closes. The
"remember on this browser" checkbox saves it in local storage instead; treat
that like saving a password, and avoid it on shared machines.

Both methods call RingCentral straight from the browser. Note that every
GitHub Pages project site under `srs1610.github.io` shares one browser origin
and so shares local storage. Only host sites you trust there. If RingCentral
ever refuses cross-origin requests for your app type, the scheduled GitHub
Actions sync does the same import server-side and is unaffected.

**Important scope limitation:** because this dashboard has no backend, the
connection lives only in the browser that made it — local storage, not shared
state. Connecting and syncing from your laptop refreshes what *you* see; it
does not push data to other people viewing the same dashboard URL. For a
single shared dataset every executive sees without connecting themselves, use
the scheduled GitHub Actions sync instead. The two are independent and can be
used together (e.g. the scheduled sync keeps the default view fresh for
everyone, while anyone who wants to double-check right now can hit "Sync now"
in Settings for their own session).

## Project structure

- `src/lib/` — CSV parsing (`parsers.ts`, `csv.ts`), metrics/aggregation (`metrics.ts`), formatting (`format.ts`)
- `src/state/` — data loading & date-range filtering (`DataContext.tsx`, `useFilteredData.ts`)
- `src/components/` — shared UI (stat tiles, chart cards) and chart primitives (`charts/`)
- `scripts/` — optional RingCentral sync job (`sync-ringcentral.mjs`), run by `.github/workflows/sync-ringcentral.yml`
- `src/sections/` — the five dashboard tabs (Overview, Call Activity, Service Quality, Messaging, Team Performance)

## Tech stack

Vite + React + TypeScript, Tailwind CSS v4, Recharts for charting, PapaParse for
CSV parsing. No backend or database — all data lives in the browser session.
