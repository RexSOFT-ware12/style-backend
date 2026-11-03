# FabricNow Style Backend

Main Node.js/Express API for the FabricNow company platform.

## Responsibilities
- Authentication and Google Sign-In
- Company/workspace accounts
- Paystack consumer and API subscriptions
- Paystack one-time order checkout and signed webhooks
- API image overage charges against Paystack payment authorizations
- Server-side API key creation/revocation
- API usage and entitlement tracking
- Garment/style APIs
- Fabric Now pattern-generation proxy
- Google Cloud Storage integration

The React workspace is intentionally a separate project. Configure its Vite `VITE_API_URL` to this API.

## Run
```bash
npm install
cp .env.example .env
npm start
```

## Production
Run the Node API and Fabric Now Python worker as separate services. The Node API is the public service; the Python worker is protected by `FABRIC_NOW_INTERNAL_SECRET`.

## Paystack billing setup
Create monthly USD plans in the Paystack dashboard with these amounts and set their plan codes in the server environment:

- Premium: $29.99/month (`PAYSTACK_PREMIUM_PLAN_CODE`)
- API Starter: $80/month (`PAYSTACK_API_STARTER_PLAN_CODE`)
- API Growth: $2,900/month (`PAYSTACK_API_GROWTH_PLAN_CODE`)

Set `PAYSTACK_SECRET_KEY` and `PAYSTACK_CURRENCY=USD`. The Paystack merchant account must support USD. API overages are charged individually against the authorization from the subscriber's first checkout: $49 per segmented image and $20 per background-removal-only image.

Configure one Paystack webhook at `https://<api-host>/api/paystack/webhook`. The handler verifies `x-paystack-signature` and processes subscription creation/renewal/cancellation, failed invoices, and successful order payments. Do not configure separate billing and orders webhook URLs.

The checkout endpoints (`POST /api/billing/checkout`, `/api/billing/api-checkout`, and `/api/orders/checkout`) return a hosted Paystack `url`; the client should redirect the customer there. To cancel, call `POST /api/billing/cancel` with `{ "product": "premium" }` or `{ "product": "api" }`. Stripe Elements and saved-card management are no longer supported; Paystack collects authorization during checkout.

Reusable Paystack authorization codes and subscription email tokens are encrypted using `SECRETS_ENCRYPTION_KEY` (or `JWT_SECRET` if unset). Keep that key stable; rotating it requires customers to authorize again.

Existing Stripe subscriptions are not migrated or canceled automatically. Stripe-backed records are intentionally excluded from paid entitlements; cancel those subscriptions in Stripe and have those customers authorize a new Paystack subscription.

## FabricNow Workspace AI update
The workspace pattern worker now supports OpenAI/Claude vision selection, Claude QA, Basic-plan-compatible exports with manifest metadata, African garment generation, fabric/print generation, mockups, technical flats, lookbooks, Aso-Ebi concepts, cutting-layout concepts, and AI product listing generation. Configure secrets only through environment variables.
