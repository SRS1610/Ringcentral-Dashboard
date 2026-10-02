# RingCentral Performance Dashboard

An executive-facing dashboard for RingCentral exported data: call activity, service
quality (SLA/abandon rate), and SMS/messaging volume, with department and agent
leaderboards.

It ships with no data. Data comes from RingCentral: the scheduled sync (below)
fills the site's data files for everyone, signing in via the Settings tab
imports into your own browser, or you can upload RingCentral CSV exports with
the **Upload data** button (uploads stay in your browser; nothing is sent to a
server). Until a tab has data it shows a "No data yet" screen explaining how to
load it, rather than zeros.

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

| Dataset | What it is | Site data file |
|---|---|---|
| Call log / call detail | RingCentral Call Log Report CSV, one row per call | `public/data/call-log.csv` |
| Analytics / Quality of Service | RingCentral Analytics Portal export (queue performance, SLA) | `public/data/analytics-qos.csv` |
| SMS / message log | RingCentral message log CSV | `public/data/sms-log.csv` |

Column headers are matched case- and punctuation-insensitively against common
RingCentral export naming (see `src/lib/parsers.ts`), so a genuine export usually
works without any remapping. If your export uses different column names, add them
to the candidate lists in that file.

The site data files hold only their header row until the scheduled sync writes
real records into the call log and SMS files. The analytics file is filled only
by uploads.

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

This sync only touches the repo's own data files. If someone uploads a
CSV through the dashboard's "Upload data" button, that file lives only in
their browser and is never affected by this sync.

## Live data: the Cloudflare Worker (recommended)

The dashboard runs on a Cloudflare Worker (`worker/`, config in `wrangler.jsonc`). The Worker serves the built site and a small JSON API under `/api/` that **signs in to RingCentral server-side** with a JWT app credential kept in Worker secrets. Viewers never handle RingCentral credentials: they enter one shared **dashboard password** in the Settings tab, and the last 30 days of calls, SMS and **service quality** import automatically. Picking dates on the calendar fetches exactly that window.

What the Worker fetches:

| Tab | RingCentral API | Notes |
|---|---|---|
| Call Activity, Team Performance, Overview | Call Log API (`/account/~/call-log`) | Company-wide when the JWT's user is an admin; otherwise that user's own calls |
| Messaging | Message Store API, per user extension | Only numbers, time, direction and status reach the browser — never message text |
| Service Quality | **Business Analytics API** (`/analytics/calls/v1/.../timeline/fetch`), grouped by call queue, one point per day | Service level = calls in SLA ÷ (in SLA + out of SLA), per the SLA target set on each queue in RingCentral. Speed of answer and handle time are averaged over answered calls (ring time; talk + hold). Analytics keeps about 184 days. |

One-time setup (whoever manages the Worker):

1. In the [RingCentral Developer Console](https://developers.ringcentral.com/), use an app with the **JWT auth flow** (the same one the scheduled sync uses) and the permissions **Read Accounts**, **Read Call Log**, **Read Messages** and **Analytics**. Create a JWT credential for an **admin** user and download the credentials JSON. The Business Analytics API needs a RingEX plan that includes it; if your plan doesn't, every other tab still works and Service Quality stays upload-only.
2. Give the Worker its secrets (from a checkout with `npm install` done, logged in with `npx wrangler login`):

   ```sh
   npx wrangler secret put RC_CREDENTIALS_JSON   # paste the whole credentials file
   npx wrangler secret put DASHBOARD_PASSWORD    # the password viewers will type
   ```

   Or add them under the Worker's *Settings → Variables and Secrets* in the Cloudflare dashboard. `RC_CLIENT_ID` / `RC_CLIENT_SECRET` / `RC_JWT` as three separate secrets also work. For a sandbox account add a plain variable `RC_SERVER_URL` = `https://platform.devtest.ringcentral.com`. If the site is already behind Cloudflare Access or similar, set the variable `DASHBOARD_AUTH` to `none` instead of a password.
3. Deploy: `npm run deploy` (builds, then `wrangler deploy`). Or let GitHub do it on every push: add the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID`, and `.github/workflows/deploy-worker.yml` runs the tests and deploys. Make sure the `name` in `wrangler.jsonc` matches your Worker.

Running it locally: `npm run dev:worker` builds the site and starts `wrangler dev` with the API. Put local secrets in a `.dev.vars` file (git-ignored), e.g. `DASHBOARD_PASSWORD=test`. Plain `npm run dev` (Vite only) has no API, and Settings says so.

How the browser talks to it: every `/api/` request carries the dashboard password. The Worker exchanges the JWT for a RingCentral access token, keeps it in memory, and also hands the browser an encrypted copy (`X-RC-Session` header) that only the Worker's secrets can open, so a recycled Worker doesn't need a new token for every viewer — RingCentral allows only a few token requests per minute. The browser can't read that blob. The access token, the client secret and the JWT never leave the Worker; the API is read-only (GET) and returns only the fields the dashboard shows. `npm test` covers these routes against a fake RingCentral.

**Who a call belongs to.** RingCentral's call log names a call's owner only by extension id, so the Worker looks the id up in the account's extension list (cached for ten minutes) to get the team member's name and extension number. A call to a queue or the main line is credited to the user who answered it, when a call leg shows one. The outside party — the caller on inbound calls, the number dialled on outbound — is never used as the owner; calls nobody on the account owns are listed as "Unassigned". The Team Performance leaderboard shows team members by default (switch to *All lines* for queues, shared lines and unassigned calls) with calls, inbound, outbound, connected, missed, voicemail, answer rate, average duration and talk time per person.

**Callers behind a metric.** On Call Activity, click a tile (Total, Inbound, Outbound, Answer rate), a bar of the Call outcomes chart, or one of the chips above the *Callers* table to list the outside callers behind that number: caller-ID name, phone number, call count, total time, last call and the team members involved.

Imported data lives in the viewer's browser tab. Uploads (the **Upload data** button) still work and override the live import for that dataset; **Clear uploads and imports** goes back to the site's data files. A static copy of the site (GitHub Pages or Netlify, below) has no `/api/`, so there the Settings tab shows "No dashboard server on this site" and only uploads and the scheduled sync's data files are available.


## Project structure

- `src/lib/` — CSV parsing (`parsers.ts`, `csv.ts`), metrics/aggregation (`metrics.ts`), formatting (`format.ts`), the client for the Worker's API (`dashboardApi.ts`, `ringcentralApi.ts`)
- `src/state/` — data loading & date-range filtering (`DataContext.tsx`, `useFilteredData.ts`)
- `src/components/` — shared UI (stat tiles, chart cards) and chart primitives (`charts/`)
- `worker/` — the Cloudflare Worker: `index.ts` (routes, dashboard password), `ringcentral.ts` (JWT sign-in, token handling), `mappers.ts` (API → dashboard records); tests in `test/`
- `scripts/` — optional RingCentral sync job (`sync-ringcentral.mjs`), run by `.github/workflows/sync-ringcentral.yml`
- `src/sections/` — the five dashboard tabs (Overview, Call Activity, Service Quality, Messaging, Team Performance)

## Tech stack

Vite + React + TypeScript, Tailwind CSS v4, Recharts for charting, PapaParse for
CSV parsing. No backend or database — all data lives in the browser session.
