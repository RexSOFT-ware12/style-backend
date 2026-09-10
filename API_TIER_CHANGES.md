# API-tier access — what was added

Implements the pricing table you approved:

| Tier | Price | Includes | Overage |
|---|---|---|---|
| API Starter | $49/mo | 500 images/mo | $0.05/image (segmented), $0.02/image (bg-removal only) |
| API Growth | $149/mo | 2,500 images/mo | same rates |
| API Enterprise | custom | custom volume | set up by hand, see notes below |

Quota is a **soft cap** — going over it doesn't block calls, it starts
billing overage via Stripe metered usage. Say the word if you'd rather
hard-block at the quota instead; it's a small change, noted inline where
it'd go (`garment-service/src/middleware/requireApiAccess.js`).

## style-backend (new/changed files)

- `src/models/ApiKey.js` — new. One user can hold several keys.
- `src/models/ApiSubscription.js` — new. One per user; tracks tier, Stripe
  linkage, current billing period, and this-period usage counters.
- `src/lib/apiTiers.js` — new. Single place pricing/quota/env-var-names live.
- `src/lib/apiKeyCrypto.js` — new. Key generation + sha256 hashing (keys are
  never stored in plaintext).
- `src/lib/apiEntitlement.js` — new. Pure "does this account have API
  access" function, same pattern as the existing `lib/entitlement.js`.
- `src/lib/stripeMeters.js` — new. Reports overage units to Stripe via the
  current **Billing Meters** API (`stripe.billing.meterEvents.create`) —
  the older `subscription_items/{id}/usage_records` endpoint was removed in
  Stripe API version `2025-03-31.basil`; every metered Price now needs a
  backing Meter.
- `src/routes/billing.js` — extended with:
  - `GET /api/billing/api-status` — dashboard: tier/quota/usage/keys
  - `POST /api/billing/api-checkout` — Stripe Checkout for starter/growth
  - `POST /api/billing/api-keys`, `GET /api/billing/api-keys`,
    `DELETE /api/billing/api-keys/:id` — key management
  - `GET /api/billing/api-key-status` — called by garment-service per request
  - `POST /api/billing/api-usage` — called by garment-service after each
    processed image; increments usage and reports overage to Stripe
  - webhook handler extended to branch on API-tier subscriptions vs. the
    existing consumer Premium plan (both now flow through the same
    `customer.subscription.*` events)
- `src/scripts/setup-api-billing.js` — new, one-time script. Creates the
  Stripe Meters + Prices and prints the env vars to paste in.
- `src/server.js` — updated endpoint list only (cosmetic).

## garment-service (new/changed files)

- `src/middleware/requireApiAccess.js` — new. API-key auth (`x-api-key`
  header), checks entitlement against the main backend, same
  fail-closed-on-outage pattern as the existing `requirePremium.js`.
- `src/routes/apiGarmentTool.js` — new. `POST /api/v1/garment/process` —
  the external developer-facing endpoint. Same processing pipeline as the
  existing dashboard route, plus fire-and-forget usage reporting after a
  successful response.
- `src/server.js` — mounts the new router at `/api/v1/garment`.

**The existing dashboard route (`/api/garment-tool/process`, JWT auth) is
untouched** — dashboard users on the $19.99/mo consumer plan work exactly
as before.

## Deploy steps

1. In `style-backend`: `STRIPE_SECRET_KEY=sk_... node src/scripts/setup-api-billing.js`
   (test mode first), paste the four printed env vars into `.env`.
2. Confirm your existing Stripe webhook endpoint has
   `checkout.session.completed` and `customer.subscription.*` enabled (it
   should already, from the consumer plan) — no new webhook endpoint needed.
3. In `garment-service`'s `.env`, set `BACKEND_API_URL` to point at the
   deployed `style-backend` (currently unset there, falls back to
   `localhost:4000` — fine for local dev, **must** be set in production).
4. Deploy both services. New dependencies: none — both services already
   have `stripe`/`mongoose`/etc. installed.

## Not done / open decisions

- **The consumer Premium plan's price ($19.99/mo) was not changed in code.**
  We discussed $24.99–29.99/mo but you hadn't picked an exact number —
  say the word and I'll create the new Stripe Price and wire up
  grandfathering for existing subscribers.
- No frontend UI was built for API-key management or the API-tier pricing
  page (this was all backend). The endpoints above are ready for a
  dashboard page to call — happy to build that next if useful.
- Enterprise tier has no self-serve Checkout by design — it's created by
  hand per the note in `setup-api-billing.js`.
