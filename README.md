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

## Project structure

- `src/lib/` — CSV parsing (`parsers.ts`, `csv.ts`), metrics/aggregation (`metrics.ts`), formatting (`format.ts`)
- `src/state/` — data loading & date-range filtering (`DataContext.tsx`, `useFilteredData.ts`)
- `src/components/` — shared UI (stat tiles, chart cards) and chart primitives (`charts/`)
- `src/sections/` — the five dashboard tabs (Overview, Call Activity, Service Quality, Messaging, Team Performance)

## Tech stack

Vite + React + TypeScript, Tailwind CSS v4, Recharts for charting, PapaParse for
CSV parsing. No backend or database — all data lives in the browser session.
