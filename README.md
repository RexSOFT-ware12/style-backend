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
- Cloudinary image and private ZIP storage

The React workspace is intentionally a separate project. Configure its Vite `VITE_API_URL` to this API.

## Run
```bash
npm install
cp .env.example .env
npm start
```

## Production
Run the Node API and Fabric Now Python worker as separate services. The Node API is the public service; the Python worker is protected by `FABRIC_NOW_INTERNAL_SECRET`.

Transactional email (sign-in alerts, welcome/billing notices, and contact form)
is sent through Resend's HTTPS API, so the backend does not need SMTP access.
Set `RESEND_API_KEY` and a `RESEND_FROM_EMAIL` address on your verified
Resend domain. `RESEND_FROM_EMAIL` is used for regular transactional email;
optionally set `RESEND_INVOICE_FROM_EMAIL` to a separate verified sender for
payment invoices. Without it, invoices use `RESEND_FROM_EMAIL`;
set `SUPPORT_EMAIL` to the inbox that should receive contact submissions and
sign-in alert copies. Successful Paystack order and subscription payments send
a branded invoice email showing the actual GHS amount charged, along with USD
catalog pricing when applicable.

The authenticated workspace copilot (`POST /api/assistant/workspace`) uses OpenAI. Set `OPENAI_API_KEY` on the Node backend; `OPENAI_ASSISTANT_MODEL` is optional and defaults to `gpt-4o-mini`. Other Gemini-powered tools remain unchanged.

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
on the backend deployment. Product/workspace images and private product ZIPs
are stored in Cloudinary; ZIP uploads are limited to 200 MB and downloads use
short-lived URLs after the backend verifies the paid order. Confirm the
Cloudinary account permits raw uploads at least 200 MB. Existing GCS-backed
or local-disk images and ZIPs must be re-uploaded.

## Paystack billing setup
Create monthly GHS plans in the Paystack dashboard with these amounts and set their plan codes and matching `*_AMOUNT` values in the server environment:

- Premium: GHS 350.13/month (`PAYSTACK_PREMIUM_PLAN_CODE`, `PAYSTACK_PREMIUM_AMOUNT`)
- API Starter: GHS 934.00/month (`PAYSTACK_API_STARTER_PLAN_CODE`, `PAYSTACK_API_STARTER_AMOUNT`)
- API Growth: GHS 33,730.80/month (`PAYSTACK_API_GROWTH_PLAN_CODE`, `PAYSTACK_API_GROWTH_AMOUNT`)

Set `PAYSTACK_SECRET_KEY`, `PAYSTACK_CURRENCY=GHS`, and the two overage amounts: GHS 572.08 per segmented image (`PAYSTACK_API_OVERAGE_SEGMENTED_AMOUNT`) and GHS 233.50 per background-removal-only image (`PAYSTACK_API_OVERAGE_BGONLY_AMOUNT`). API overages are charged individually against the authorization from the subscriber's first checkout. Product catalog prices remain USD and are converted to GHS for checkout using the fixed `PAYSTACK_USD_GHS_RATE=11.68`.

Configure one Paystack webhook at `https://<api-host>/api/paystack/webhook`. The handler verifies `x-paystack-signature` and processes subscription creation/renewal/cancellation, failed invoices, and successful order payments. Do not configure separate billing and orders webhook URLs.

The checkout endpoints (`POST /api/billing/checkout`, `/api/billing/api-checkout`, and `/api/orders/checkout`) return a hosted Paystack `url`; the client should redirect the customer there. To cancel, call `POST /api/billing/cancel` with `{ "product": "premium" }` or `{ "product": "api" }`. Stripe Elements and saved-card management are no longer supported; Paystack collects authorization during checkout.

Reusable Paystack authorization codes and subscription email tokens are encrypted using `SECRETS_ENCRYPTION_KEY` (or `JWT_SECRET` if unset). Keep that key stable; rotating it requires customers to authorize again.

Existing Stripe subscriptions are not migrated or canceled automatically. Stripe-backed records are intentionally excluded from paid entitlements; cancel those subscriptions in Stripe and have those customers authorize a new Paystack subscription.

## FabricNow Workspace AI update
The workspace pattern worker now supports OpenAI/Claude vision selection, Claude QA, Basic-plan-compatible exports with manifest metadata, African garment generation, fabric/print generation, mockups, technical flats, lookbooks, Aso-Ebi concepts, cutting-layout concepts, and AI product listing generation. Configure secrets only through environment variables.
