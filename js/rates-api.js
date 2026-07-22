/* ============================================================
   GoldNest – IBJA Live Rates Fetcher
   ============================================================
   Pulls the latest official IBJA (Indian Bullion & Jewellers
   Association) AM/PM rate from ibjarates.com via a public CORS
   proxy, caches the result in localStorage for 2 hours, and
   exposes window.GoldNestRates.fetch() as a Promise.

   IBJA only publishes twice a day (12:00 PM and 5:00 PM IST),
   so an aggressive cache is fine.

   USAGE
     <script src="js/rates-api.js"></script>
     <script>
       window.GoldNestRates.fetch().then(rates => {
         console.log(rates);
         // { gold999_per_gram,
         //   silver999_per_gram, source, timestamp, ... }
       });
     </script>
   ============================================================ */
(function () {
  'use strict';

  const CACHE_KEY     = 'goldnest_rates_v2';
  const CACHE_TTL_MS  = 2 * 60 * 60 * 1000; // 2 hours

  /* ------------------------------------------------------------
     GOLDNEST API — primary source (same source the mobile app uses)
     ------------------------------------------------------------
     Per the backend team: "inme jo last record hai wo live rate hai"
     — the LAST entry of the yearly series is today's live rate.
     So we read the series and take series[series.length - 1].

     The API sends `Access-Control-Allow-Origin: *`, so the browser can
     call it directly. On goldsnest.com it is same-origin anyway.

     NOTE: this token is intentionally client-side. It is read-only and
     only exposes public gold/silver prices. Replace it below if the
     backend issues a new one.
  ------------------------------------------------------------ */
  const API_BASE  = 'https://goldsnest.com/api';
  const API_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI4IiwianRpIjoiZDk2MzMwNDZiNmE3OTk0MzkyMDVjZDUzYzE3NTFiZjY3OTEwZmM4N2U0ZmVlOTFmMmIzM2IzNmMwOTZiNjIxYTZlNjA4MTA2NjY0NzE4MWMiLCJpYXQiOjE3ODMzMzcyMzIuOTA5NDgxLCJuYmYiOjE3ODMzMzcyMzIuOTA5NDg0LCJleHAiOjE4MTQ4NzMyMzIuODg3NzIyLCJzdWIiOiI0MDQiLCJzY29wZXMiOltdfQ.QqYvm_YcNg866v6psACoqtkKsyJbRH4RWMTmDDfrtN7OdvhgeLrMdO73OpKwzXw6dhCtNyxfqHFxWR0au1VEJ7SmXWdP-9Yyt3pPb7HCnvnarTV0d4FllI7jqRfq_q-8CaerYSaT0A02ZwUDUQyzK-q4vGx1XrpMbPDrJdOV5_jalWrTksYm--LtA4ZzSRp35_5CppadsSkwANnKhcOXpAr0-YH_EqiuMgC1uW42XzHtt9P_2qoyQMW3ORJl3vWT8YyU-WDGvPOb2QDgWAO21j1BwVIBiR1KoU2yMIVYWBY2Z3E26LfXFT3UJxfrnaQIkM8yywwH8rXE1he9Ikg7tb9oq8bzXpCdwHwv297SZUe28I-XVyE4pybcpJc9KzOe6GFhQVfWJRywLHMwhNrrGCknZ-SaawPBg2WCqjPDbeQaI04K8XDwxq3PsTMb2T8dnOjLm4e_UyKhyox2EcjBXw47-Ggq5CS0P2utTxDNiZzh3QEZ0yiGIR7Q8gSc7Btc4EfoJPRWDeEAS1P5BhyMVvulxnZ_lZaeXbsaS_7lh_pUdRS6KATGredNE6xB8dnXBlRhaN28dPmKCjDCzu89TjpT4DoXP5GOrh0bsp_5dxYvdqg7Yz83uxLEjQx9Xnnk-mOvrBoh7yH8gPvXeS_Rg2j7BzLqWZx4hUcufchKxEA';
  const API_ENDPOINTS = {
    gold:   '/yearly-chart',
    silver: '/yearly-silver-chart',
  };

  // Public CORS proxies — tried in order. Each returns raw HTML.
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy/?quest=',
  ];
  const SOURCES = [
    'https://www.ibjarates.com/',
    'https://ibja.co/',
  ];

  // NO hardcoded rate fallback.
  // The site must never display an invented gold/silver price, so if
  // every live source fails we resolve with null values and pages keep
  // showing their "—" placeholder instead of a stale number.
  const FALLBACK = Object.freeze({
    gold999_per_gram:   null,
    silver999_per_gram: null,
    source:             'unavailable',
    timestamp:          0,
    isStale:            true,
  });

  /* ------------------------------------------------------------
     Public entry point
     ------------------------------------------------------------
     Resolution order (each step short-circuits on success):
       1. Same-origin /rates.json   ← PRODUCTION path
          (GitHub Action commits this twice daily after IBJA AM/PM)
       2. localStorage cache (< 2 hours old)
       3. CORS proxy → IBJA scrape  (best-effort fallback)
       4. Stale localStorage cache
       5. Null rates (pages keep their "—" placeholder)
  ------------------------------------------------------------ */
  async function fetchIBJARates(opts = {}) {
    // 0 — GoldNest API (same source as the mobile app) — PREFERRED
    try {
      const apiRates = await fetchGoldNestApi();
      if (apiRates) {
        writeCache(apiRates);
        return apiRates;
      }
    } catch (_) {}

    // 1 — same-origin JSON (fastest, no CORS, no third-party)
    try {
      const localJson = await fetchLocalJson();
      if (localJson) {
        writeCache(localJson);
        return localJson;
      }
    } catch (_) {}

    // 2 — fresh localStorage cache
    if (!opts.force) {
      const cached = readCache();
      if (cached) return cached;
    }

    // 3 — CORS proxy → IBJA  (only as a fallback for static-only deployments)
    for (const proxy of PROXIES) {
      for (const source of SOURCES) {
        try {
          const url = proxy + encodeURIComponent(source);
          const res = await fetchWithTimeout(url, 6000);
          if (!res.ok) continue;
          const html = await res.text();
          if (!html || html.length < 200) continue;
          const parsed = parseRates(html);
          if (parsed && parsed.gold999_per_gram) {
            const rates = {
              ...FALLBACK,
              ...parsed,
              source:    'IBJA (proxy)',
              timestamp: Date.now(),
              isStale:   false,
            };
            writeCache(rates);
            return rates;
          }
        } catch (_) { /* try next combination */ }
      }
    }

    // 4 — stale cache (better than nothing)
    const stale = readCache(true);
    if (stale) return { ...stale, isStale: true };

    // 5 — hard-coded fallback
    return { ...FALLBACK, timestamp: Date.now() };
  }

  /* ------------------------------------------------------------
     GoldNest API fetcher — the app's own source of truth.
     Calls the yearly gold + silver endpoints and uses the LAST
     record of each series as the live rate (per the backend team).
     Silver is optional: if it fails, gold alone still resolves and
     silver falls back down the chain.
  ------------------------------------------------------------ */
  async function fetchGoldNestApi() {
    if (!API_TOKEN) return null;              // not configured yet

    const call = async (path) => {
      const res = await fetchWithTimeout(API_BASE + path, 7000, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + API_TOKEN,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: '{}',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const rows = json && Array.isArray(json.data) ? json.data : null;
      if (!rows || !rows.length) throw new Error('empty data');
      // LAST record = live rate.
      const last = rows[rows.length - 1];
      const val = parseFloat(last && last.close_price);
      return Number.isFinite(val) ? { value: val, day: last.day } : null;
    };

    // Gold is required; silver is best-effort.
    const gold = await call(API_ENDPOINTS.gold);
    if (!gold || !isValidGold(gold.value)) return null;

    let silver = null;
    try {
      const s = await call(API_ENDPOINTS.silver);
      if (s && isValidSilver(s.value)) silver = s;
    } catch (_) { /* silver optional */ }

    const g = gold.value;
    return {
      gold999_per_gram:   Math.round(g),
      silver999_per_gram: silver ? Math.round(silver.value * 100) / 100
                                 : FALLBACK.silver999_per_gram,
      source:    'GoldNest',
      session:   '',
      rate_date: gold.day || '',
      timestamp: Date.now(),
      isStale:   false,
    };
  }

  /* ------------------------------------------------------------
     Same-origin rates.json fetcher
     The file is produced by .github/workflows/update-rates.yml
     running scripts/update-rates.js — see scripts/README.md
  ------------------------------------------------------------ */
  async function fetchLocalJson() {
    // Cache-bust at most once per cache TTL window so updates show up
    // promptly without hammering origin on every page load.
    const bucket = Math.floor(Date.now() / CACHE_TTL_MS);
    const url = '/rates.json?v=' + bucket;
    const res = await fetchWithTimeout(url, 4000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !isValidGold(data.gold999_per_gram)) return null;
    return {
      gold999_per_gram:   data.gold999_per_gram,
      silver999_per_gram: isValidSilver(data.silver999_per_gram) ? data.silver999_per_gram : FALLBACK.silver999_per_gram,
      source:             data.source || 'IBJA',
      session:            data.session || '',
      timestamp:          data.fetched_at ? new Date(data.fetched_at).getTime() : Date.now(),
      isStale:            false,
    };
  }

  /* ------------------------------------------------------------
     Plausibility ranges — anything outside is rejected as a
     parser/HTML mismatch (e.g. picking up a purity label like 995
     or a stray small integer).  Tuned for the Indian market.
  ------------------------------------------------------------ */
  const GOLD_MIN  = 4000;   // ₹/gram — even 2015 lows were well above this
  const GOLD_MAX  = 30000;  // ₹/gram — extremely unlikely upper bound
  const SILV_MIN  = 50;     // ₹/gram
  const SILV_MAX  = 500;    // ₹/gram

  function isValidGold(v)   { return typeof v === 'number' && isFinite(v) && v >= GOLD_MIN && v <= GOLD_MAX; }
  function isValidSilver(v) { return typeof v === 'number' && isFinite(v) && v >= SILV_MIN && v <= SILV_MAX; }

  /* ------------------------------------------------------------
     Cache helpers
  ------------------------------------------------------------ */
  function readCache(allowStale) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Reject cache that fails range check (e.g. corrupted by old buggy parser)
      if (!data || !isValidGold(data.gold999_per_gram)) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      const age = Date.now() - (data.timestamp || 0);
      if (!allowStale && age > CACHE_TTL_MS) return null;
      return data;
    } catch (_) {
      return null;
    }
  }
  function writeCache(rates) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
    } catch (_) {}
  }

  function fetchWithTimeout(url, ms, init) {
    return new Promise((resolve, reject) => {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (ctrl) ctrl.abort();
        reject(new Error('timeout'));
      }, ms);
      const opts = Object.assign({}, init || {}, ctrl ? { signal: ctrl.signal } : {});
      fetch(url, opts)
        .then(r => { clearTimeout(timer); resolve(r); })
        .catch(e => { clearTimeout(timer); reject(e); });
    });
  }

  /* ------------------------------------------------------------
     HTML parsing — multiple strategies, since IBJA's markup
     varies between ibja.co (homepage, per-gram) and
     ibjarates.com (full rate table, per-10g and per-kg)
  ------------------------------------------------------------ */
  function parseRates(html) {
    // Try each strategy in turn; first one that yields a value within
    // GOLD_MIN..GOLD_MAX wins.  Anything outside that range almost
    // certainly means the regex matched a label (e.g. 995 purity).
    const goldCandidates = [];
    const silverCandidates = [];

    // --- A. ibja.co homepage:  <h3>16098 (1 Gram) ...</h3>
    re(/<h3[^>]*>\s*([\d,]+)\s*\(\s*1\s*Gram/gi, html, m => goldCandidates.push(perGram(toNum(m[1]))));

    // --- B. tabular rate row near "Fine Gold" / "Fine Gold (999)"
    //   Skip any purity-style number (3 digits, 500-999) which is a
    //   label, not a price.  Look for the next 4-6 digit value.
    re(/Fine\s*Gold[\s\S]{0,160}?(\d{4,6}(?:\.\d+)?)/gi, html, m => goldCandidates.push(perGram(toNum(m[1]))));

    // --- C. row keyed by "999" purity → next number nearby
    re(/(?:^|>)\s*999\s*(?:<[^>]*>\s*){1,4}([\d,]+(?:\.\d+)?)/g, html, m => goldCandidates.push(perGram(toNum(m[1]))));

    // --- D. anything with a ₹ symbol immediately followed by a 4-6 digit number
    re(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/g, html, m => goldCandidates.push(perGram(toNum(m[1]))));

    // --- Silver: look for "Silver" followed by a 4+ digit number (per kg/10g)
    //   Reject anything < 1000 (likely a year, purity, or other label).
    re(/Silver[\s\S]{0,160}?(\d{4,8}(?:\.\d+)?)/gi, html, m => silverCandidates.push(perGramFromSilver(toNum(m[1]))));

    // Pick first plausible gold value
    const gold999 = goldCandidates.find(isValidGold);
    if (!gold999) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[GoldNestRates] No gold value passed validation. Candidates:', goldCandidates);
      }
      return null;
    }

    const silver = silverCandidates.find(isValidSilver) || null;
    if (silverCandidates.length && !silver && typeof console !== 'undefined' && console.warn) {
      console.warn('[GoldNestRates] No silver value passed validation. Candidates:', silverCandidates);
    }

    return {
      gold999_per_gram:   round(gold999),
      silver999_per_gram: silver != null ? round1(silver) : null,
    };
  }

  // Run a global regex and call `fn` for every match.
  function re(pattern, html, fn) {
    let m;
    let safety = 100;
    while ((m = pattern.exec(html)) !== null && safety-- > 0) {
      try { fn(m); } catch (_) {}
      if (!pattern.global) break;
    }
  }

  function toNum(s) {
    if (!s) return null;
    const n = parseFloat(String(s).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function round(n)  { return Math.round(n); }
  function round1(n) { return Math.round(n * 100) / 100; }

  // Convert a number that could be per-gram or per-10g into per-gram.
  // If the value is unreasonably large for per-gram, divide by 10.
  function perGram(v) {
    if (v == null) return null;
    if (v > 30000)      return v / 10;   // clearly per-10g
    if (v > 4000)       return v;        // already per-gram
    return v;
  }
  function perGramFromSilver(v) {
    if (v == null) return null;
    if (v > 5000)  return v / 1000;      // per-kg → per-gram
    if (v > 500)   return v / 10;        // per-10g → per-gram
    return v;
  }

  /* ------------------------------------------------------------
     Apply helper — given a freshly-fetched rates object, this
     overwrites BASE constants & re-renders any registered page
     hooks. Pages register themselves via window.GoldNestRates.onUpdate.
  ------------------------------------------------------------ */
  const updateHandlers = [];
  function onUpdate(fn) {
    if (typeof fn === 'function') updateHandlers.push(fn);
  }
  function notifyAll(rates) {
    for (const fn of updateHandlers) {
      try { fn(rates); } catch (_) {}
    }
  }

  /* ------------------------------------------------------------
     Format helper — "Updated 2h ago via IBJA"
  ------------------------------------------------------------ */
  function formatAge(timestamp) {
    if (!timestamp) return '';
    const min = Math.round((Date.now() - timestamp) / 60000);
    if (min < 1)   return 'just now';
    if (min < 60)  return min + ' min ago';
    const hr = Math.round(min / 60);
    if (hr < 24)   return hr + ' hr ago';
    const d = Math.round(hr / 24);
    return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  }

  /* ------------------------------------------------------------
     Public API
  ------------------------------------------------------------ */
  window.GoldNestRates = {
    fetch:     fetchIBJARates,
    onUpdate:  onUpdate,
    notifyAll: notifyAll,
    formatAge: formatAge,
    fallback:  FALLBACK,
  };

  // Auto-fetch as soon as the script loads so by the time the page
  // is ready the cache is warm.
  document.addEventListener('DOMContentLoaded', () => {
    fetchIBJARates().then(notifyAll).catch(() => {});
  });
})();
