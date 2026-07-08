/* ============================================================
   GoldNest — IBJA Rates Lambda (AWS-native refresh)
   ------------------------------------------------------------
   Fetches the official IBJA rates, parses + validates gold and
   silver per-gram values, and writes rates.json to the S3 bucket
   that backs the static site, then invalidates CloudFront so the
   new file is served immediately.

   Triggered by EventBridge (see ../template.yaml) on the same
   cadence the old GitHub Action used:
       09:00 IST (daily safety net) · 12:30 IST · 17:30 IST

   This is the SAME parse/validation logic as
   scripts/update-rates.js — kept in sync intentionally so the
   static-repo path and the AWS path never disagree.

   Environment variables (set in template.yaml):
     BUCKET_NAME              S3 bucket serving the site
     RATES_KEY                object key for the JSON (default rates.json)
     CLOUDFRONT_DISTRIBUTION  distribution id to invalidate (optional)

   Runtime: nodejs20.x  (global fetch + AWS SDK v3 available)
   ============================================================ */
'use strict';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';

const SOURCES = ['https://www.ibjarates.com/', 'https://ibja.co/'];

// Plausibility ranges — anything outside is a parser/HTML mismatch.
const GOLD_MIN = 4000, GOLD_MAX = 30000; // ₹/gram
const SILV_MIN = 50,   SILV_MAX = 500;   // ₹/gram

const UA =
  'Mozilla/5.0 (compatible; GoldNestRateBot/1.0; +https://goldsnest.com)';

const s3 = new S3Client({});
const cf = new CloudFrontClient({});

/* ------------------------------------------------------------ */
async function fetchSource(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const html = await res.text();
  if (!html || html.length < 500)
    throw new Error(`${url} → suspiciously short response (${html.length} bytes)`);
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
  if (v > 200000) return null;   // probably per-kg
  if (v > 30000) return v / 10;  // per-10g
  return v;                       // already per-gram
}

function perGramSilver(v) {
  if (v == null) return null;
  if (v > 5000) return v / 1000; // per-kg
  if (v > 500) return v / 10;    // per-10g
  return v;                       // per-gram
}

function isValidGold(v)   { return Number.isFinite(v) && v >= GOLD_MIN && v <= GOLD_MAX; }
function isValidSilver(v) { return Number.isFinite(v) && v >= SILV_MIN && v <= SILV_MAX; }

/* ------------------------------------------------------------ */
function parseRates(html) {
  // Strip HTML comments first (ibja.co keeps an archived 2020
  // rate-template inside <!-- ... --> that would poison text regex).
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  const gold = [];
  const silver = [];

  // === GOLD ===
  for (const m of html.matchAll(/id\s*=\s*["']lblFineGold999["'][^>]*>\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]{3,})/gi))
    gold.push(perGram(toNum(m[1])));
  for (const m of html.matchAll(/id\s*=\s*["']GoldRatesCompare999["'][^>]*>\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]{3,})/gi))
    gold.push(perGram(toNum(m[1])));
  for (const m of html.matchAll(/<h3[^>]*>\s*([\d,]+)\s*\(\s*1\s*Gram/gi))
    gold.push(perGram(toNum(m[1])));
  for (const m of html.matchAll(/Fine\s*Gold[\s\S]{0,200}?(?:₹|&#8377;|Rs\.?|INR)\s*([\d,]{4,6}(?:\.\d+)?)/gi))
    gold.push(perGram(toNum(m[1])));
  for (const m of html.matchAll(/(?:^|>)\s*999\s*(?:<[^>]*>\s*){1,4}([\d,]{4,})/g))
    gold.push(perGram(toNum(m[1])));
  for (const m of html.matchAll(/(?:₹|Rs\.?|INR)\s*([\d,]{4,}(?:\.\d+)?)/g))
    gold.push(perGram(toNum(m[1])));

  // === SILVER ===
  for (const m of html.matchAll(/id\s*=\s*["']lblSilver999_(?:AM|PM)["'][^>]*>\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]{3,})/gi))
    silver.push(perGramSilver(toNum(m[1])));
  for (const m of html.matchAll(/id\s*=\s*["']SilverRatesCompare999["'][^>]*>\s*(?:₹|&#8377;|Rs\.?|INR)?\s*([\d,]{3,})/gi))
    silver.push(perGramSilver(toNum(m[1])));
  for (const m of html.matchAll(/Silver[\s\S]{0,160}?(\d{4,8}(?:\.\d+)?)/gi))
    silver.push(perGramSilver(toNum(m[1])));

  const gold999 = gold.find(isValidGold);
  const silver999 = silver.find(isValidSilver);

  if (!gold999) return { ok: false, reason: 'gold-not-parseable', gold, silver };

  return {
    ok: true,
    gold999_per_gram: Math.round(gold999),
    gold22k_per_gram: Math.round(gold999 * 0.916),
    gold18k_per_gram: Math.round(gold999 * 0.75),
    silver999_per_gram: silver999 != null ? Math.round(silver999 * 100) / 100 : null,
  };
}

/* ------------------------------------------------------------ */
export const handler = async () => {
  const BUCKET = process.env.BUCKET_NAME;
  const KEY = process.env.RATES_KEY || 'rates.json';
  const DIST = process.env.CLOUDFRONT_DISTRIBUTION;

  if (!BUCKET) throw new Error('BUCKET_NAME env var is required');

  console.log(`[update-rates] start — bucket=${BUCKET} key=${KEY}`);

  let parsed, lastErr;
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
    // Do NOT overwrite S3 with bad data — leave the last good rates.json.
    const msg = `ALL sources failed. Keeping existing rates.json. last error: ${lastErr ? lastErr.message : 'unknown'}`;
    console.error(`[update-rates] ${msg}`);
    throw new Error(msg); // surfaces as a Lambda error → CloudWatch alarm
  }

  // AM/PM session label by IST hour
  const istHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
  const session = istHour < 15 ? 'AM' : 'PM';

  const out = {
    gold999_per_gram: parsed.gold999_per_gram,
    gold22k_per_gram: parsed.gold22k_per_gram,
    gold18k_per_gram: parsed.gold18k_per_gram,
    silver999_per_gram: parsed.silver999_per_gram,
    source: 'IBJA',
    session,
    fetched_at: new Date().toISOString(),
    source_url: parsed._source_url,
  };

  const body = JSON.stringify(out, null, 2) + '\n';

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      Body: body,
      ContentType: 'application/json',
      // Short cache so browsers/CloudFront re-check; the client also
      // cache-busts with ?v=. Tune to taste.
      CacheControl: 'public, max-age=300, must-revalidate',
    })
  );
  console.log(`[update-rates] wrote s3://${BUCKET}/${KEY}`);

  if (DIST) {
    await cf.send(
      new CreateInvalidationCommand({
        DistributionId: DIST,
        InvalidationBatch: {
          CallerReference: `rates-${out.fetched_at}`,
          Paths: { Quantity: 1, Items: ['/' + KEY] },
        },
      })
    );
    console.log(`[update-rates] invalidated CloudFront ${DIST} for /${KEY}`);
  }

  console.log('[update-rates] done', out);
  return { statusCode: 200, body: out };
};
