#!/usr/bin/env node
/* ============================================================
   GoldNest — Gold 1-Year History Fetcher
   ------------------------------------------------------------
   Calls the GoldNest yearly-chart API (Bearer-authenticated),
   normalises the daily 24K gold close series, and writes
   ../gold-history.json which gold-rates.html reads same-origin.

   The API token MUST stay server-side — never ship it to the
   browser. Provide it via the GOLDNEST_API_TOKEN env var.

   Usage:
     GOLDNEST_API_TOKEN=eyJ0eXA... node scripts/update-gold-history.js

   Exit codes:
     0  success — gold-history.json written (or unchanged)
     1  fatal — could not fetch/parse; existing file untouched
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const API_URL = 'https://www.website4test.com/goldnest/api/yearly-chart';
const OUT_FILE = path.join(__dirname, '..', 'gold-history.json');
const TOKEN = process.env.GOLDNEST_API_TOKEN;

// The upstream Apache/mod_security rejects requests unless a JSON
// Content-Type + body and a browser-like UA are present (verified).
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (compatible; GoldNestHistoryBot/1.0; +https://goldsnest.com)',
};

async function main() {
  if (!TOKEN) {
    console.error('[gold-history] GOLDNEST_API_TOKEN env var is required');
    process.exit(1);
  }

  console.log(`[gold-history] ${new Date().toISOString()} — fetching ${API_URL}`);
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
    console.error(`[gold-history] fetch failed: ${e.message} — keeping existing file`);
    process.exit(1);
  }

  if (!json || json.status !== true || !Array.isArray(json.data)) {
    console.error('[gold-history] unexpected payload — keeping existing file');
    process.exit(1);
  }

  const series = json.data
    .filter((r) => r && r.day && r.close_price != null)
    .map((r) => ({ d: String(r.day), c: Math.round(parseFloat(r.close_price) * 100) / 100 }))
    .filter((r) => Number.isFinite(r.c) && r.c > 1000 && r.c < 100000)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  if (series.length < 2) {
    console.error(`[gold-history] too few valid points (${series.length}) — keeping existing file`);
    process.exit(1);
  }

  const out = {
    metal: 'gold999',
    unit: 'INR_per_gram',
    source: 'GoldNest yearly-chart API',
    points: series.length,
    from: series[0].d,
    to: series[series.length - 1].d,
    fetched_at: new Date().toISOString(),
    series,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out) + '\n', 'utf8');
  console.log(
    `[gold-history] wrote ${OUT_FILE}: ${series.length} points, ${out.from} → ${out.to}`
  );
}

main().catch((err) => {
  console.error('[gold-history] uncaught:', err);
  process.exit(1);
});
