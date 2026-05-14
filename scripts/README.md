# GoldNest — IBJA Rates Pipeline

Production setup for keeping `rates.json` in sync with the official
**Indian Bullion & Jewellers Association** rates (the same source most
jewellers use as their daily reference).

```
                ┌──────────────────────────┐
                │   GitHub Actions (cron)   │
                │   .github/workflows/      │
                │   update-rates.yml        │
                └─────────────┬─────────────┘
                              │  3× daily
                              ▼
                ┌──────────────────────────┐
                │  scripts/update-rates.js  │
                │  • fetch ibjarates.com    │
                │  • parse + validate       │
                │  • write ../rates.json    │
                └─────────────┬─────────────┘
                              │  git commit + push
                              ▼
                ┌──────────────────────────┐
                │       rates.json          │  ← repo root
                └─────────────┬─────────────┘
                              │  same-origin fetch
                              ▼
                ┌──────────────────────────┐
                │     js/rates-api.js       │
                │  • window.GoldNestRates   │
                │  • localStorage cache 2h  │
                └─────────────┬─────────────┘
                              │  applyRates(...)
                              ▼
        index.html · gold-rates.html · silver-rates.html
```

## Files

| Path | Role |
|---|---|
| [scripts/update-rates.js](update-rates.js) | Node 18+ scraper. Fetches IBJA, parses gold/silver per-gram values, validates against plausibility ranges, writes `../rates.json`. |
| [.github/workflows/update-rates.yml](../.github/workflows/update-rates.yml) | GitHub Action. 3 scheduled runs/day + manual trigger. Commits `rates.json` back to the repo. |
| [rates.json](../rates.json) | Public artifact — same-origin JSON served to the browser. |
| [js/rates-api.js](../js/rates-api.js) | Frontend module. Prefers same-origin `rates.json`, falls back to CORS proxy → cache → hard-coded values. |

## Schedule (UTC → IST)

```
07:00 UTC  =  12:30 PM IST  (after IBJA AM publishes ~12:00)
12:00 UTC  =  05:30 PM IST  (after IBJA PM publishes ~05:00)
03:30 UTC  =  09:00 AM IST  (overnight safety net before market opens)
```

Weekdays only on the first two. The overnight run is daily — IBJA doesn't
publish on Sat/Sun so it's a no-op (the script keeps the previous file if
it can't parse fresh values).

## Required repo settings

In **Settings → Actions → General → Workflow permissions**, set:

> ✅ **Read and write permissions**
> ✅ Allow GitHub Actions to create and approve pull requests *(optional)*

This grants the bot user the `contents: write` permission so it can
push the `rates.json` commit back to `main`.

The workflow uses the auto-provisioned `GITHUB_TOKEN` — no PAT, no
secrets to manage.

## Manual usage

### Run the scraper locally
```bash
node scripts/update-rates.js
```
Prints the parsed values to stdout and overwrites `rates.json`. Useful
for ad-hoc updates if Actions is paused.

### Trigger the workflow manually
GitHub UI → **Actions → Update IBJA Rates → Run workflow**.

### Force the browser to refetch
`js/rates-api.js` caches in `localStorage` for 2 hours. In DevTools
Console:
```js
localStorage.removeItem('goldnest_ibja_rates_v1');
window.GoldNestRates.fetch({ force: true }).then(window.GoldNestRates.notifyAll);
```

## Validation rules

The scraper **only writes** `rates.json` if the parsed numbers pass
plausibility checks:

| Metric | Min | Max | Unit |
|---|---|---|---|
| Gold 999 | 4,000 | 30,000 | ₹ / gram |
| Silver 999 | 50 | 500 | ₹ / gram |

If parsing yields values outside these ranges (e.g. a regex caught a
purity label like `995` instead of the rate), the script logs the
rejected candidates and exits with code 1. The previous `rates.json`
stays untouched, the workflow run is marked as failed in the Actions
tab, and the repo owner receives the default email notification.

## Frontend resolution order

`js/rates-api.js` tries these in order, stopping at the first success:

1. **Same-origin `/rates.json`** — production path, fastest, no CORS
2. **localStorage cache** — < 2 hours old
3. **CORS proxy → IBJA scrape** — only useful for static deployments
   without a build step
4. **Stale localStorage cache** — better than wrong/missing data
5. **Hard-coded fallback** in `FALLBACK` constant

Each page that needs rates registers a handler:
```js
window.GoldNestRates.onUpdate(rates => {
  // overwrite local BASE constants, re-render UI
});
window.GoldNestRates.fetch();
```

## Operational notes

- **Free tier cost** on public repos: $0 (unlimited Actions minutes).
  On private repos: ~2 min/month against the 2,000 free min/month
  allowance.
- **No API keys** anywhere — IBJA's HTML is publicly published.
- **Resilient to IBJA outages** — if a scheduled run fails, the previous
  `rates.json` continues to serve users until the next successful run.
- **Resilient to weekends / holidays** — IBJA does not publish, the
  scraper either parses the previous trading day's values or fails
  cleanly; either way users see the last valid rate.
- **Update the seed values** in `rates.json` annually so first-load
  before the first cron run shows a current-ish rate.
