# Workspace environment

Main Node backend:
- `OPENAI_API_KEY` (workspace assistant)
- `OPENAI_ASSISTANT_MODEL` (optional; defaults to `gpt-4o-mini`)
- `MONGODB_URI`
- `JWT_SECRET` (long random value)
- `SECRETS_ENCRYPTION_KEY` (keep stable; encrypts Paystack reusable authorization data)
- `GOOGLE_CLIENT_ID`
- `CONTACT_EMAIL` (optional; recipient for `POST /api/contact`, defaults to `SMTP_USER`)
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_CURRENCY=GHS`
- `PAYSTACK_PREMIUM_PLAN_CODE` (monthly GHS 350.13)
- `PAYSTACK_API_STARTER_PLAN_CODE` (monthly GHS 934.00)
- `PAYSTACK_API_GROWTH_PLAN_CODE` (monthly GHS 35,025.00)
- `PAYSTACK_PREMIUM_AMOUNT=350.13`
- `PAYSTACK_API_STARTER_AMOUNT=934.00`
- `PAYSTACK_API_GROWTH_AMOUNT=35025.00`
- `PAYSTACK_API_OVERAGE_SEGMENTED_AMOUNT=572.08`
- `PAYSTACK_API_OVERAGE_BGONLY_AMOUNT=233.50`
- `PAYSTACK_USD_GHS_RATE=11.68` (fixed conversion for USD-priced product catalog orders)
- Configure the Paystack webhook URL as `https://<api-host>/api/paystack/webhook`
  - Subscribe to `charge.success`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, and `invoice.payment_failed`
- `WORKSPACE_URL`
- `FABRIC_NOW_SERVICE_URL`
- `FABRIC_NOW_INTERNAL_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET` (server-side only; do not expose it in the dashboard)

Python worker:
- `OPENAI_API_KEY`
- `FABRIC_NOW_INTERNAL_SECRET` (must exactly match Node)
- `MAX_CONCURRENT_JOBS`
- image-model settings from `fabric-now-worker/backend/.env.example`

Google OAuth:
- Add the deployed workspace origin to the Google OAuth client configuration.
- Set the same client ID in the Node `GOOGLE_CLIENT_ID` environment variable.

Cloudinary stores product and workspace images plus authenticated ZIP downloads.
ZIPs are limited to 200 MB and are delivered through short-lived links only
after the existing order ownership and payment checks. Existing GCS and
local-disk assets are not migrated automatically; re-upload product and
workspace images and ZIP files.
Confirm the Cloudinary plan allows raw uploads of at least 200 MB.
