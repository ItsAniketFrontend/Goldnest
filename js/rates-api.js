/* ============================================================
   GoldNest — Live Rates (API-only)
   ------------------------------------------------------------
   Single source of truth: the GoldNest API — the SAME source the
   mobile app uses, so the website and app always agree.

     Gold:   POST /api/yearly-chart
     Silver: POST /api/yearly-silver-chart

   Per the backend team, the LAST record of each daily series is the
   live rate. We take the most recent record whose close_price is a
   real, positive number (the feed occasionally publishes today's row
   with 0.00 before the price is set).

   There is intentionally NO IBJA scraping and NO bundled rates.json
   fallback: if the API is unreachable we show the last value cached in
   this browser, and otherwise a clear "unavailable" state — never a
   number from a different source.

   USAGE
     <script src="js/rates-api.js"></script>
     window.GoldNestRates.fetch().then(r => { ... });
     window.GoldNestRates.onUpdate(r => { ... });
   ============================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------
     Config — the ONLY source.
     The token is read-only (public price data) and is intentionally
     client-side, exactly like the app. Replace if the backend rotates it.
  ------------------------------------------------------------ */
  const API_BASE  = 'https://goldsnest.com/api';
  const API_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI4IiwianRpIjoiZDk2MzMwNDZiNmE3OTk0MzkyMDVjZDUzYzE3NTFiZjY3OTEwZmM4N2U0ZmVlOTFmMmIzM2IzNmMwOTZiNjIxYTZlNjA4MTA2NjY0NzE4MWMiLCJpYXQiOjE3ODMzMzcyMzIuOTA5NDgxLCJuYmYiOjE3ODMzMzcyMzIuOTA5NDg0LCJleHAiOjE4MTQ4NzMyMzIuODg3NzIyLCJzdWIiOiI0MDQiLCJzY29wZXMiOltdfQ.QqYvm_YcNg866v6psACoqtkKsyJbRH4RWMTmDDfrtN7OdvhgeLrMdO73OpKwzXw6dhCtNyxfqHFxWR0au1VEJ7SmXWdP-9Yyt3pPb7HCnvnarTV0d4FllI7jqRfq_q-8CaerYSaT0A02ZwUDUQyzK-q4vGx1XrpMbPDrJdOV5_jalWrTksYm--LtA4ZzSRp35_5CppadsSkwANnKhcOXpAr0-YH_EqiuMgC1uW42XzHtt9P_2qoyQMW3ORJl3vWT8YyU-WDGvPOb2QDgWAO21j1BwVIBiR1KoU2yMIVYWBY2Z3E26LfXFT3UJxfrnaQIkM8yywwH8rXE1he9Ikg7tb9oq8bzXpCdwHwv297SZUe28I-XVyE4pybcpJc9KzOe6GFhQVfWJRywLHMwhNrrGCknZ-SaawPBg2WCqjPDbeQaI04K8XDwxq3PsTMb2T8dnOjLm4e_UyKhyox2EcjBXw47-Ggq5CS0P2utTxDNiZzh3QEZ0yiGIR7Q8gSc7Btc4EfoJPRWDeEAS1P5BhyMVvulxnZ_lZaeXbsaS_7lh_pUdRS6KATGredNE6xB8dnXBlRhaN28dPmKCjDCzu89TjpT4DoXP5GOrh0bsp_5dxYvdqg7Yz83uxLEjQx9Xnnk-mOvrBoh7yH8gPvXeS_Rg2j7BzLqWZx4hUcufchKxEA';
  const ENDPOINTS = { gold: '/yearly-chart', silver: '/yearly-silver-chart' };

  const CACHE_KEY    = 'goldnest_rates_v3';
  const TIMEOUT_MS   = 12000;   // the API answers in ~3-7s; give real headroom

  // Plausibility ranges — reject anything obviously wrong.
  const GOLD_MIN = 4000, GOLD_MAX = 30000;  // ₹/gram
  const SILV_MIN = 50,   SILV_MAX = 500;    // ₹/gram
  function isValidGold(v)   { return typeof v === 'number' && isFinite(v) && v >= GOLD_MIN && v <= GOLD_MAX; }
  function isValidSilver(v) { return typeof v === 'number' && isFinite(v) && v >= SILV_MIN && v <= SILV_MAX; }

  /* ------------------------------------------------------------
     Public entry point.
       1. Live API (gold + silver in parallel).
       2. Last value cached in THIS browser (a previous API success).
       3. null → pages show their "—" placeholder / unavailable note.
  ------------------------------------------------------------ */
  async function fetchRates(opts = {}) {
    try {
      const live = await fetchGoldNestApi();
      if (live) { writeCache(live); return live; }
    } catch (_) {}

    if (!opts.noCache) {
      const cached = readCache();
      if (cached) return { ...cached, isStale: true };
    }
    return null;
  }

  /* ------------------------------------------------------------
     Call both endpoints; take the newest real (>0) close from each.
  ------------------------------------------------------------ */
  async function fetchGoldNestApi() {
    if (!API_TOKEN) return null;

    const call = async (path) => {
      const res = await fetchWithTimeout(API_BASE + path, TIMEOUT_MS, {
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
      // Newest row with a real, positive close (skip 0.00 placeholder rows).
      for (let i = rows.length - 1; i >= 0; i--) {
        const val = parseFloat(rows[i] && rows[i].close_price);
        if (Number.isFinite(val) && val > 0) return { value: val, day: rows[i].day };
      }
      return null;
    };

    // Gold is required; silver is best-effort (page still works if it fails).
    const [goldRes, silverRes] = await Promise.allSettled([
      call(ENDPOINTS.gold),
      call(ENDPOINTS.silver),
    ]);

    const gold = goldRes.status === 'fulfilled' ? goldRes.value : null;
    if (!gold || !isValidGold(gold.value)) return null;

    let silver = null;
    if (silverRes.status === 'fulfilled' && silverRes.value && isValidSilver(silverRes.value.value)) {
      silver = silverRes.value;
    }

    return {
      gold999_per_gram:   Math.round(gold.value),
      silver999_per_gram: silver ? Math.round(silver.value * 100) / 100 : null,
      source:    'GoldNest',
      rate_date: gold.day || '',
      timestamp: nowMs(),
      isStale:   false,
    };
  }

  /* ------------------------------------------------------------
     Browser cache — remembers the last successful API value so a
     repeat visitor sees a number instantly while the fresh one loads.
  ------------------------------------------------------------ */
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.source !== 'GoldNest' || !isValidGold(data.gold999_per_gram)) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return data;
    } catch (_) { return null; }
  }
  function writeCache(rates) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rates)); } catch (_) {}
  }

  function nowMs() { return (typeof Date !== 'undefined') ? Date.now() : 0; }

  function fetchWithTimeout(url, ms, init) {
    return new Promise((resolve, reject) => {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, ms);
      const opts = Object.assign({}, init || {}, ctrl ? { signal: ctrl.signal } : {});
      fetch(url, opts)
        .then(r => { clearTimeout(timer); resolve(r); })
        .catch(e => { clearTimeout(timer); reject(e); });
    });
  }

  /* ------------------------------------------------------------
     Page hooks
  ------------------------------------------------------------ */
  const updateHandlers = [];
  function onUpdate(fn) { if (typeof fn === 'function') updateHandlers.push(fn); }
  function notifyAll(rates) {
    for (const fn of updateHandlers) { try { fn(rates); } catch (_) {} }
  }

  function formatAge(timestamp) {
    if (!timestamp) return '';
    const min = Math.round((nowMs() - timestamp) / 60000);
    if (min < 1)  return 'just now';
    if (min < 60) return min + ' min ago';
    const hr = Math.round(min / 60);
    if (hr < 24)  return hr + ' hr ago';
    const d = Math.round(hr / 24);
    return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  }

  /* Force a fresh fetch (used by the "Refresh Rate" button). */
  function refresh() {
    return fetchRates({ noCache: true })
      .then(r => { if (r) notifyAll(r); return r; })
      .catch(() => null);
  }

  /* ------------------------------------------------------------
     Public API
  ------------------------------------------------------------ */
  window.GoldNestRates = {
    fetch:    fetchRates,
    refresh:  refresh,
    onUpdate: onUpdate,
    notifyAll: notifyAll,
    formatAge: formatAge,
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Paint a previously-cached GoldNest value instantly (repeat visitors),
    // then replace it with the fresh live value when it arrives.
    const cached = readCache();
    if (cached) notifyAll({ ...cached, isStale: true });

    fetchRates().then(r => { if (r) notifyAll(r); }).catch(() => {});
  });
})();
