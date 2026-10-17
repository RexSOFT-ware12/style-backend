# Workspace environment

Main Node backend:
- `MONGODB_URI`
- `JWT_SECRET` (long random value)
- `GOOGLE_CLIENT_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_BILLING_WEBHOOK_SECRET` (if used separately)
- `STRIPE_API_STARTER_PRICE_ID`
- `STRIPE_API_GROWTH_PRICE_ID`
- `STRIPE_API_OVERAGE_SEGMENTED_PRICE_ID`
- `STRIPE_API_OVERAGE_BGONLY_PRICE_ID`
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
