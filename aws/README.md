# GoldNest on AWS — Deployment Guide

The site is a **static website**. Deploying it is just static hosting:
**S3 (private) + CloudFront**, with `/api/*` routed to the existing
`goldsnest.com` backend for the contact/enquiry forms.

**There is no rate-refresh job to run.** Live gold/silver rates are fetched
directly in the browser from the GoldNest API — the same source the mobile
app uses — so the website and app always match:

```
        Browser  js/rates-api.js
                    │  POST (with Bearer token)
                    ▼
        https://goldsnest.com/api/yearly-chart        (gold)
        https://goldsnest.com/api/yearly-silver-chart (silver)
                    │  last record = live rate
                    ▼
        Rate shown on the page
```

No Lambda, no EventBridge, no `rates.json`, no IBJA scraping — all of that
was removed. Nothing server-side needs to run to keep rates fresh.

---

## Part 1 — Host the static site (S3 + CloudFront)

### 1a. Create the bucket and upload

```bash
BUCKET=goldnest-site           # pick a globally-unique name
REGION=ap-south-1              # Mumbai, closest to the audience

aws s3 mb "s3://$BUCKET" --region "$REGION"

# Upload everything EXCEPT dev/infra files (see .deployignore below).
aws s3 sync . "s3://$BUCKET" \
  --exclude ".git/*" --exclude ".github/*" --exclude "aws/*" \
  --exclude "scripts/*" --exclude ".claude/*" --exclude "*.md" \
  --exclude "images/*.mp4" \
  --delete
```

The chart data files use a short cache so the 1-year charts stay current:

```bash
aws s3 cp gold-history.json "s3://$BUCKET/gold-history.json" \
  --content-type application/json \
  --cache-control "public, max-age=300, must-revalidate"
aws s3 cp silver-history.json "s3://$BUCKET/silver-history.json" \
  --content-type application/json \
  --cache-control "public, max-age=300, must-revalidate"
```

(Live rates need no such file — they come from the API in the browser.)

### 1b. Put CloudFront in front (recommended: HTTPS + caching + custom domain)

- Origin: the S3 bucket (use an **Origin Access Control**, keep the bucket private).
- Default root object: `index.html`.
- **Custom error responses:** map 403 and 404 → `/index.html` is *not*
  needed here (this is a multi-page site, not a SPA). Instead add a 404
  response pointing at a real page if you have one, or leave default.
- Attach your ACM cert (in `us-east-1`) for `goldsnest.com`.

> S3-only (no CloudFront) also works via S3 static website hosting, but you
> lose HTTPS on the bucket endpoint and edge caching. CloudFront is the
> production choice.

---

## Part 2 — Live rates (nothing to deploy)

Live gold/silver rates are fetched **client-side** by `js/rates-api.js`
straight from the GoldNest API. There is no Lambda, no cron, and no
`rates.json` — so there is nothing to deploy or schedule for rates.

The only requirement is that the two API endpoints stay reachable and the
Bearer token in `js/rates-api.js` stays valid:

- `POST https://goldsnest.com/api/yearly-chart`
- `POST https://goldsnest.com/api/yearly-silver-chart`

If the token is ever rotated, update the `API_TOKEN` constant near the top
of `js/rates-api.js` and redeploy the static files. If the API is briefly
unreachable, the page shows the last value cached in the visitor's browser
(with a small "last available rate" note), then updates on the next load.

---

## Part 3 — Route `/api/*` to the existing backend (forms)

The contact form (`contact.html`) and partner enquiry form (`partner.html`)
POST to the **relative** path `/api/contact-us`, which is handled by the
existing backend at `goldsnest.com` (verified live: returns
`{"success":true,...}` for `{ name, email, message }`).

Because the static site is served under **the same domain** (`goldsnest.com`),
this is a same-origin request — no CORS needed. For it to resolve, the
CloudFront distribution must send `/api/*` to the backend instead of S3:

1. In CloudFront, add a **second origin** pointing at the backend host that
   serves `goldsnest.com/api/*` (the existing app server / API).
2. Add a **cache behavior** with path pattern `/api/*` → that origin, with:
   - Viewer methods: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
   - Caching: **disabled** (use the `CachingDisabled` managed policy).
   - Origin request policy: forward all headers/body (`AllViewerExceptHostHeader`
     or `AllViewer`).
3. Leave the **default behavior** (`/*`) pointing at the S3 origin for the
   static pages.

> Result: `https://goldsnest.com/contact.html` (static, from S3) and
> `https://goldsnest.com/api/contact-us` (dynamic, from the backend) share one
> origin in the browser — forms submit without CORS.

If you ever host the static site on a **different** domain, switch the two
`fetch('/api/contact-us', …)` calls to the absolute
`https://goldsnest.com/api/contact-us` **and** have the backend add
`Access-Control-Allow-Origin` for that domain (it currently sends none).

---

## Quick pre-launch checklist

- [ ] Static files uploaded to S3; CloudFront default root object = `index.html`.
- [ ] `/api/*` behaviour routes to the goldsnest.com backend (forms + rates).
- [ ] ACM cert + `goldsnest.com` CNAME attached to the distribution.
- [ ] Open the live site → gold-rates / silver-rates show the **live GoldNest
      rate** (matching the app), and it stays steady (no per-second ticking),
      on **mobile and desktop**.
- [ ] The 1-year charts render (from `gold-history.json` / `silver-history.json`).
- [ ] Contact + partner forms submit with no 404 in the browser console.
- [ ] `API_TOKEN` in `js/rates-api.js` is current (rotate if the backend reissues).
