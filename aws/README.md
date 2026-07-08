# GoldNest on AWS — Deployment Guide

This folder makes the site **AWS-ready** two ways:

1. **Static hosting** of the site itself (S3 + CloudFront).
2. **AWS-native rate refresh** — a Lambda on an EventBridge schedule that
   keeps `rates.json` in sync with the official IBJA rate, replacing the
   GitHub Action so nothing depends on GitHub once you're live.

```
  EventBridge (cron 3x/day)
        │
        ▼
  Lambda  goldnest-update-rates   ── scrapes ibjarates.com
        │                            parses + validates
        ├─► S3  s3://<bucket>/rates.json   (last-good on failure)
        └─► CloudFront invalidation /rates.json
                    │
                    ▼
        Browser  js/rates-api.js  → same-origin /rates.json
```

The Lambda uses the **same parse + validation logic** as
`scripts/update-rates.js`, so the two paths never disagree.

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

Set the right `Content-Type`/cache for `rates.json` (short cache so rate
updates show up fast):

```bash
aws s3 cp rates.json "s3://$BUCKET/rates.json" \
  --content-type application/json \
  --cache-control "public, max-age=300, must-revalidate"
```

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

## Part 2 — Deploy the AWS-native rate refresher

Requires the **AWS SAM CLI** (`sam --version`) and credentials with rights to
create Lambda/IAM/EventBridge/CloudWatch.

```bash
cd aws/lambda
npm install          # pulls the two AWS SDK v3 clients
cd ..

sam build

sam deploy --guided \
  --stack-name goldnest-rates \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      SiteBucketName=goldnest-site \
      RatesKey=rates.json \
      CloudFrontDistributionId=EXXXXXXXXXXXXX   # or leave '' for S3-only
```

On subsequent deploys just run `sam build && sam deploy` (config is saved to
`samconfig.toml`).

### Force an immediate refresh (and smoke-test)

```bash
aws lambda invoke --function-name goldnest-update-rates /dev/stdout
# then confirm the object updated:
aws s3 cp s3://goldnest-site/rates.json - | cat
```

### Schedule (all times IST)

| Trigger                | Cron (UTC)          | Runs                     |
|------------------------|---------------------|--------------------------|
| Daily safety net       | `30 3 * * ? *`      | 09:00 IST, every day     |
| After IBJA AM rate     | `0 7 ? * MON-FRI *` | 12:30 IST, weekdays      |
| After IBJA PM rate     | `0 12 ? * MON-FRI *`| 17:30 IST, weekdays      |

### Failure behaviour (important)

If **both** IBJA sources are unreachable or the markup changed so nothing
parses within the plausibility range, the Lambda **throws and does NOT
overwrite** `rates.json` — the last good rate stays live. The throw trips the
`goldnest-update-rates-errors` CloudWatch alarm so you find out. Wire that
alarm to an SNS topic / email to get notified.

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

## Retiring the GitHub Action

Once the Lambda is confirmed writing to S3, disable the old workflow so the
two don't both commit/write:

- Delete or disable `.github/workflows/update-rates.yml` (Actions tab →
  workflow → ⋯ → Disable), **or** keep it only as a repo-side backup that
  commits to git but is no longer the production source.

The site reads `rates.json` **same-origin** either way — on AWS that file now
comes from S3, written by the Lambda.

---

## Quick pre-launch checklist

- [ ] `rates.json` shows today's real IBJA rate (gold ≈ ₹14.5k/g range, not ₹9k).
- [ ] `sam deploy` succeeded; manual `lambda invoke` updated the S3 object.
- [ ] CloudFront serves `https://<domain>/rates.json` with the fresh value.
- [ ] Open the live site → gold-rates / silver-rates show the IBJA number
      (check the "Updated … via IBJA" stamp), on **mobile and desktop**.
- [ ] CloudWatch alarm has an SNS/email target.
- [ ] Old GitHub Action disabled (or demoted to backup).
