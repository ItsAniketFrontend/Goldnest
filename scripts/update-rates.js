#!/usr/bin/env node
/* ============================================================
   GoldNest — IBJA Rates Scraper
   ------------------------------------------------------------
   Runs server-side (GitHub Actions or any Node 18+ host).
   Fetches the official IBJA rates page, parses gold and silver
   per-gram values, validates them against plausibility ranges,
   and writes ../rates.json.

   Exit codes:
     0  success — rates.json updated (or unchanged because IBJA
        hasn't published anything new yet)
     1  fatal — could not fetch or parse; rates.json NOT touched
        (workflow surfaces failure in the Actions UI / email)

   Usage:
     node scripts/update-rates.js
   ============================================================ */
'use strict';

const fs   = require('fs');
const path = require('path');

const SOURCES = [
  'https://www.ibjarates.com/',
  'https://ibja.co/',
];
const OUT_FILE = path.join(__dirname, '..', 'rates.json');

// Plausibility ranges — anything outside is a parser/HTML mismatch.
const GOLD_MIN = 4000,  GOLD_MAX = 30000;   // ₹/gram
const SILV_MIN = 50,    SILV_MAX = 500;     // ₹/gram

const UA = 'Mozilla/5.0 (compatible; GoldNestRateBot/1.0; +https://goldsnest.com)';

/* ------------------------------------------------------------ */
async function fetchSource(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const html = await res.text();
  if (!html || html.length < 500) throw new Error(`${url} → suspiciously short response (${html.length} bytes)`);
  return html;
}

/* ------------------------------------------------------------ */
function toNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function perGram(v) {
  if (v == null) return null;
  if (v > 200000) return null;          // probably per-kg
  if (v > 30000)  return v / 10;        // per-10g
  return v;                              // already per-gram
}

function perGramSilver(v) {
  if (v == null) return null;
  if (v > 5000)  return v / 1000;       // per-kg
  if (v > 500)   return v / 10;         // per-10g
  return v;                              // per-gram
}

function isValidGold(v)   { return Number.isFinite(v) && v >= GOLD_MIN && v <= GOLD_MAX; }
function isValidSilver(v) { return Number.isFinite(v) && v >= SILV_MIN && v <= SILV_MAX; }

/* ------------------------------------------------------------ */
function parseRates(html) {
  const gold = [];
  const silver = [];

  // Strategy A — ibja.co homepage:  <h3>16098 (1 Gram) ...</h3>
  for (const m of html.matchAll(/<h3[^>]*>\s*([\d,]+)\s*\(\s*1\s*Gram/gi)) {
    gold.push(perGram(toNum(m[1])));
  }
  // Strategy B — anchored on "Fine Gold"; require 4+ digits (rules out purity labels)
  for (const m of html.matchAll(/Fine\s*Gold[\s\S]{0,160}?(\d{4,6}(?:\.\d+)?)/gi)) {
    gold.push(perGram(toNum(m[1])));
  }
  // Strategy C — table cell containing "999" followed by the next 4-6 digit number
  for (const m of html.matchAll(/(?:^|>)\s*999\s*(?:<[^>]*>\s*){1,4}([\d,]{4,})/g)) {
    gold.push(perGram(toNum(m[1])));
  }
  // Strategy D — explicit currency markers (₹ / Rs. / INR)
  for (const m of html.matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]{4,}(?:\.\d+)?)/g)) {
    gold.push(perGram(toNum(m[1])));
  }

  // Silver — require 4+ digits after "Silver"
  for (const m of html.matchAll(/Silver[\s\S]{0,160}?(\d{4,8}(?:\.\d+)?)/gi)) {
    silver.push(perGramSilver(toNum(m[1])));
  }

  const gold999 = gold.find(isValidGold);
  const silver999 = silver.find(isValidSilver);

  if (!gold999) {
    return { ok: false, reason: 'gold-not-parseable', gold, silver };
  }
  return {
    ok: true,
    gold999_per_gram:   Math.round(gold999),
    gold22k_per_gram:   Math.round(gold999 * 0.916),
    gold18k_per_gram:   Math.round(gold999 * 0.750),
    silver999_per_gram: silver999 != null ? Math.round(silver999 * 100) / 100 : null,
  };
}

/* ------------------------------------------------------------ */
async function main() {
  console.log(`[update-rates] ${new Date().toISOString()} — starting`);

  let lastErr;
  let parsed;

  for (const url of SOURCES) {
    try {
      console.log(`[update-rates] fetching ${url}`);
      const html = await fetchSource(url);
      const r = parseRates(html);
      if (r.ok) {
        parsed = r;
        parsed._source_url = url;
        console.log(`[update-rates] parsed from ${url}: gold=${r.gold999_per_gram}, silver=${r.silver999_per_gram}`);
        break;
      }
      console.warn(`[update-rates] ${url} parsed but failed validation: ${r.reason}`);
      lastErr = new Error(`${url}: ${r.reason}`);
    } catch (e) {
      console.warn(`[update-rates] ${url} failed: ${e.message}`);
      lastErr = e;
    }
  }

  if (!parsed) {
    console.error('[update-rates] ALL sources failed. Keeping existing rates.json untouched.');
    console.error(`[update-rates] last error: ${lastErr ? lastErr.message : 'unknown'}`);
    process.exit(1);
  }

  // Determine AM/PM session label by IST hour
  const istHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
  }).format(new Date()));
  const session = istHour < 15 ? 'AM' : 'PM';

  const out = {
    gold999_per_gram:   parsed.gold999_per_gram,
    gold22k_per_gram:   parsed.gold22k_per_gram,
    gold18k_per_gram:   parsed.gold18k_per_gram,
    silver999_per_gram: parsed.silver999_per_gram,
    source:             'IBJA',
    session,
    fetched_at:         new Date().toISOString(),
    source_url:         parsed._source_url,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[update-rates] wrote ${OUT_FILE}`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => {
  console.error('[update-rates] uncaught:', err);
  process.exit(1);
});
