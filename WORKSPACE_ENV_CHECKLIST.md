# Workspace environment

Main Node backend:
- `MONGODB_URI`
- `JWT_SECRET` (long random value)
- `SECRETS_ENCRYPTION_KEY` (keep stable; encrypts Paystack reusable authorization data)
- `GOOGLE_CLIENT_ID`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_CURRENCY=USD` (USD must be enabled for the Paystack merchant account)
- `PAYSTACK_PREMIUM_PLAN_CODE` (monthly USD 29.99)
- `PAYSTACK_API_STARTER_PLAN_CODE` (monthly USD 80)
- `PAYSTACK_API_GROWTH_PLAN_CODE` (monthly USD 2,900)
- Configure the Paystack webhook URL as `https://<api-host>/api/paystack/webhook`
  - Subscribe to `charge.success`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, and `invoice.payment_failed`
- `WORKSPACE_URL`
- `FABRIC_NOW_SERVICE_URL`
- `FABRIC_NOW_INTERNAL_SECRET`
- `STORAGE_BUCKET` / `GCS_BUCKET_NAME`

Python worker:
- `OPENAI_API_KEY`
- `FABRIC_NOW_INTERNAL_SECRET` (must exactly match Node)
- `MAX_CONCURRENT_JOBS`
- image-model settings from `fabric-now-worker/backend/.env.example`

Google OAuth:
- Add the deployed workspace origin to the Google OAuth client configuration.
- Set the same client ID in the Node `GOOGLE_CLIENT_ID` environment variable.
