#!/usr/bin/env node
/* ============================================================
   GoldNest — Silver 1-Year History Fetcher
   ------------------------------------------------------------
   Calls the GoldNest yearly-silver-chart API (Bearer-authenticated),
   normalises the daily 999 silver close series, and writes
   ../silver-history.json which silver-rates.html reads same-origin.

   The API token MUST stay server-side — never ship it to the
   browser. Provide it via the GOLDNEST_API_TOKEN env var.

   Usage:
     GOLDNEST_API_TOKEN=eyJ0eXA... node scripts/update-silver-history.js

   Exit codes:
     0  success — silver-history.json written (or unchanged)
     1  fatal — could not fetch/parse; existing file untouched
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

// Production endpoint (goldsnest.com). Override with GOLDNEST_API_BASE
// if you run against a different host (e.g. localhost during dev).
const API_BASE = process.env.GOLDNEST_API_BASE || 'https://goldsnest.com/api';
const API_URL = API_BASE.replace(/\/$/, '') + '/yearly-silver-chart';
const OUT_FILE = path.join(__dirname, '..', 'silver-history.json');
const TOKEN = process.env.GOLDNEST_API_TOKEN;

// The backend needs a JSON Content-Type + body and a browser-like UA
// to get past its request filtering (same as the gold endpoint).
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; GoldNestHistoryBot/1.0; +https://goldsnest.com)',
};

async function main() {
  if (!TOKEN) {
    console.error('[silver-history] GOLDNEST_API_TOKEN env var is required');
    process.exit(1);
  }

  console.log(`[silver-history] ${new Date().toISOString()} — fetching ${API_URL}`);
  let json;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: HEADERS,
      body: '{}',
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.error(`[silver-history] fetch failed: ${e.message} — keeping existing file`);
    process.exit(1);
  }

  // Accept either { status:true, data:[...] } or { success:true, data:[...] }
  const rows = json && Array.isArray(json.data) ? json.data : null;
  if (!rows) {
    console.error('[silver-history] unexpected payload — keeping existing file');
    process.exit(1);
  }

  const series = rows
    .filter((r) => r && r.day && r.close_price != null)
    .map((r) => ({ d: String(r.day), c: Math.round(parseFloat(r.close_price) * 100) / 100 }))
    // silver ₹/gram plausibility window
    .filter((r) => Number.isFinite(r.c) && r.c > 10 && r.c < 5000)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  if (series.length < 2) {
    console.error(`[silver-history] too few valid points (${series.length}) — keeping existing file`);
    process.exit(1);
  }

  const out = {
    metal: 'silver999',
    unit: 'INR_per_gram',
    source: 'GoldNest yearly-silver-chart API',
    points: series.length,
    from: series[0].d,
    to: series[series.length - 1].d,
    fetched_at: new Date().toISOString(),
    series,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out) + '\n', 'utf8');
  console.log(
    `[silver-history] wrote ${OUT_FILE}: ${series.length} points, ${out.from} → ${out.to}`
  );
}

main().catch((err) => {
  console.error('[silver-history] uncaught:', err);
  process.exit(1);
});
