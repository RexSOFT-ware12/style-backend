# Consumer Premium plan: $19.99 → $29.99, with grandfathering

Finishes the three open items from `API_TIER_CHANGES.md`'s "Not done" section.

## What changed

- New subscribers now pay **$29.99/mo** for Premium (Garment Tool + Pose
  Tool + SVG customization).
- Subscribers who joined before this change **keep paying $19.99/mo**,
  indefinitely, until they cancel/re-subscribe or explicitly change plans.
- The account page can now show a subscriber their *actual* price (not just
  "you're on Premium"), and flag when it's a legacy/grandfathered rate.

## How grandfathering actually works

Stripe Prices are immutable, and an existing subscription keeps referencing
whatever Price it was created with — raising "the" price for new signups
never touches subscriptions that already exist. So the whole feature is:

1. `STRIPE_PREMIUM_PRICE_ID` always points at the *current* self-serve
   price. `POST /api/billing/checkout` (new subscribers only) reads it at
   call time, so once you point it at the new $29.99 Price, every new
   Checkout session uses that — no code change needed per price bump.
2. We never touch anyone's existing Stripe subscription. That's the entire
   grandfathering mechanism — there's no "grandfather flag" to set.
3. To let the UI show a subscriber's *real* price (not just assume
   everyone pays list price), the webhook now caches the actual billed
   price on their `User` doc (`premiumPriceId`, `premiumUnitAmountCents`)
   every time it processes a `customer.subscription.created/updated` event
   for them. `lib/entitlement.js` reads that cache to compute
   `premiumPriceUsd` and `isGrandfathered` (true if their cached price is
   below today's list price).

## Files changed (style-backend)

- `src/lib/premiumPricing.js` — new. Single place the current list price
  ($29.99 → 2999 cents) lives, plus the `isGrandfathered` comparison. Bump
  `CURRENT_PRICE_CENTS` here the next time the price changes.
- `src/models/User.js` — added `premiumPriceId` / `premiumUnitAmountCents`,
  cached from Stripe (see below), never derived from the current env var.
- `src/lib/entitlement.js` — `getEntitlement()` now also returns
  `currentPremiumPriceUsd` (today's list price, for the /pricing page),
  `premiumPriceUsd` (this user's actual price, or `null` if unknown yet),
  and `isGrandfathered`. Flows straight through to `GET /api/billing/status`
  and — for API-metered users hitting the tool via garment-service — the
  forwarded entitlement payload there too (harmless extra fields it doesn't
  use).
- `src/routes/billing.js` — the `customer.subscription.created/updated`
  webhook handler's consumer-plan branch now stamps `premiumPriceId` /
  `premiumUnitAmountCents` from the subscription's actual price item.
  Comments updated to describe the new price + grandfathering instead of
  hardcoding "$19.99/mo".
- `src/scripts/setup-premium-price-v2.js` — new, one-time. Creates the
  $29.99 Price on the *same* Stripe Product as the existing $19.99 Price
  (so it's price history on one product, not two disconnected products).
  Prints the new `STRIPE_PREMIUM_PRICE_ID` to paste in.
- `src/scripts/backfill-premium-price.js` — new, one-time. For subscribers
  who predate this change: looks up their live Stripe subscription once and
  populates `premiumPriceId`/`premiumUnitAmountCents` immediately, instead
  of waiting for their next renewal to naturally fire the webhook.
- `.env.example` — documented `STRIPE_PREMIUM_PRICE_ID` alongside the
  existing API-tier price env vars.

## Deploy steps

1. In `style-backend`, with the **old** $19.99 price id still in
   `STRIPE_PREMIUM_PRICE_ID`:
   `STRIPE_SECRET_KEY=sk_... STRIPE_PREMIUM_PRICE_ID=price_old... node src/scripts/setup-premium-price-v2.js`
   (test mode first). It prints a new price id.
2. Update `.env`: `STRIPE_PREMIUM_PRICE_ID=<the new price id>`. From this
   point, new Checkout sessions charge $29.99/mo. Nothing else to flip.
3. Run `node src/scripts/backfill-premium-price.js` once so existing
   subscribers' account pages immediately show their real ($19.99) price
   instead of waiting for their next renewal webhook.
4. Deploy. No frontend env changes needed — the price now comes from
   `/api/billing/status`, not a hardcoded string (see below).

## Frontend (styles/styles)

- `lib/billing.ts` — `EntitlementStatus` now includes
  `currentPremiumPriceUsd`, `premiumPriceUsd`, `isGrandfathered`.
- `components/pricing/PricingPlans.tsx` — the Premium card now renders
  `entitlement.currentPremiumPriceUsd` (falls back to $29.99 if the
  entitlement hasn't loaded / user is logged out) instead of a hardcoded
  "$19.99", and shows a "You're grandfathered at $X/mo" note for
  subscribers whose `isGrandfathered` is true instead of the generic
  "Manage billing" copy implying they pay list price.

## Not done / open decisions

- No email/notice was sent to existing subscribers about the price change
  for *new* customers — arguably not needed since it doesn't affect them,
  but worth confirming that's intentional before launch.
- If you ever want to move grandfathered subscribers onto the new price on
  a schedule (e.g. "grandfathering ends in 6 months"), that's a deliberate
  migration script (using Stripe's subscription-update API to swap the
  subscription item's price) — nothing here does that automatically, by
  design.
