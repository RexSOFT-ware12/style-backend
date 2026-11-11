# FabricNow — Paystack hosted checkout billing implementation

## What changed

- FabricNow subscription and digital-product checkout redirects customers to Paystack-hosted checkout using the `authorization_url` returned by Paystack.
- Checkout initialization intentionally does not send a `channels` allowlist, so Paystack can show all payment methods enabled and eligible for the merchant account and transaction.
- Both Styles and Workspace keep displaying catalogue prices in USD. The browser is not sent a GHS equivalent, GHS transaction amount, or GHS currency field.
- The Ghana backend uses GHS for Paystack transactions and subscription plans. Subscription GHS amounts are fixed in the backend/Paystack plan; USD is the storefront display price.
- The backend calculates one-time product-order conversions using `PAYSTACK_USD_GHS_RATE`. This rate is server-only.
- Payment activation remains webhook-driven and verified against Paystack transaction status, amount, and currency.
- The Stripe card-entry/saved-card UI was removed from Workspace. Paystack collects card details directly; FabricNow does not receive or store card numbers or CVCs. The backend may store Paystack's reusable authorization reference encrypted to support subscription renewals and authorized usage overages; this is not raw card data.
- Cancellation uses FabricNow's backend endpoint and Paystack's subscription-disable API. There is no Stripe-style hosted billing portal.

## Required backend environment

Set these values in the deployed `style-backend` environment (do not commit `.env`):

```dotenv
PAYSTACK_SECRET_KEY=sk_test_... # use sk_live_... only when ready for production
PAYSTACK_CURRENCY=GHS
FABRICNOW_PREMIUM_PRICE_USD=29.99
PAYSTACK_PREMIUM_AMOUNT=350.13
PAYSTACK_PREMIUM_PLAN_CODE=PLN_...
PAYSTACK_API_STARTER_AMOUNT=934.00
PAYSTACK_API_STARTER_PLAN_CODE=PLN_...
PAYSTACK_API_GROWTH_AMOUNT=33730.80
PAYSTACK_API_GROWTH_PLAN_CODE=PLN_...
PAYSTACK_USD_GHS_RATE=11.68
```

- `FABRICNOW_PREMIUM_PRICE_USD` is the customer-facing USD catalogue price only.
- `PAYSTACK_PREMIUM_AMOUNT`, `PAYSTACK_API_STARTER_AMOUNT`, and `PAYSTACK_API_GROWTH_AMOUNT` are GHS major-unit amounts. Each must exactly match its corresponding monthly GHS plan in Paystack.
- `PAYSTACK_USD_GHS_RATE` is used for one-time product orders only. It does not change the GHS amount of an already-created monthly subscription plan.
- Confirm all amounts and plan codes against your actual Paystack dashboard before deploying. The example values are carried over from the supplied project configuration; they are not a live quote or a guarantee of your current plan setup.
- Do not set `PAYSTACK_CURRENCY=USD` for a Ghana Paystack account. The backend intentionally rejects it.

## Paystack dashboard configuration

1. Create/confirm the monthly Premium, API Starter, and API Growth plans in **GHS** with exact amounts matching the environment values.
2. In Paystack Dashboard, enable the payment methods available to your Ghana business (such as bank transfer or mobile money) and complete any required approvals. Paystack determines availability by merchant account, transaction currency, customer location, and device/browser; the backend cannot force an unavailable method to appear.
3. Ask Paystack to confirm Apple Pay eligibility for this Ghana account. Apple Pay appears only for eligible transactions and supported Apple devices/browsers; it is not guaranteed by enabling hosted checkout.
4. Configure the webhook URL as `https://YOUR-API-HOST/api/paystack/webhook` for both test and live environments as applicable.
5. Keep the secret key only on the backend. Do not add it to either frontend `.env` file.
6. Test with Paystack test keys and test cards before switching to live keys.

One-time digital-product checkout can use any payment method Paystack makes available for that transaction. Recurring subscriptions may require a reusable authorization, so Paystack may not offer bank transfer or Apple Pay for subscription checkout even when those methods are available for one-time payments.

## Deployment order

1. Deploy the updated `style-backend` first with the GHS environment values and matching GHS Paystack plans.
2. Deploy the updated Styles frontend.
3. Deploy the updated Workspace frontend.
4. Test Premium, API Starter/Growth, digital-product checkout, webhook activation, renewal, failed renewal, and cancellation.
5. Confirm the webhook returns HTTP 200 and that subscriptions only activate after a verified successful payment.

## Important operational notes

- This package changes the source code only. It does not log in to Paystack, create plans in your merchant account, set your production environment variables, or deploy your hosted applications.
- Full dependency-based production builds were not run in this environment because the ZIP archives did not include `node_modules`. Changed JavaScript backend files passed Node syntax checks, and the edited TS/TSX/JSX files passed TypeScript parser/transpilation syntax checks.
- Your uploaded archives contained local environment files. The updated ZIPs intentionally omit `.env`, `.env.local`, `.env.*` secrets, `.git`, and generated dependency/build folders. Keep your existing private environment files locally and add the new `FABRICNOW_PREMIUM_PRICE_USD` variable to the backend environment.
