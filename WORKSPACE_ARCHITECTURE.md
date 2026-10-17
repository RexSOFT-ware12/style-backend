# FabricNow company workspace

## Main backend
`src/server.js` is the public backend of record. It owns:
- email/password authentication
- Google sign-in
- JWT sessions
- Stripe subscriptions / Billing Portal
- API tiers, API keys and usage
- MongoDB user and billing records
- workspace API routes

## Pattern processing
`fabric-now-worker/backend` contains the original Fabric Now pattern-generation
pipeline. It is an internal processing worker, not a second user-facing app.
The main backend proxies `/api/workspace/patterns` and `/api/workspace/jobs/*`
to it and passes the authenticated user ID.

## Frontend
`workspace/` is a professional company dashboard with:
Overview, Pattern Studio, Projects, Analytics, API Keys, Usage, Billing,
Company, Settings and Help & Docs.

Users sign in at `/login` or create an account at `/signup`. Google sign-in
uses the existing server-side `/api/auth/google` verification.

## Billing
API access uses the existing Stripe API Starter/Growth tiers. API secrets are
created server-side and only the plaintext key is returned once.

## Deployment
For Google Cloud, deploy the Node backend as the main App Engine/Cloud Run
application and deploy the Python worker as an internal Cloud Run service.
Set `FABRIC_NOW_SERVICE_URL` to the worker's internal URL and protect it with
`FABRIC_NOW_INTERNAL_SECRET`.

Google Cloud Storage remains the storage target for the existing Node-side
assets. The worker's job directory is ephemeral in this first merge; for
multi-instance production, put completed worker outputs in GCS as the next
storage hardening step.

## Fashion OS layer (2026-10)

The workspace now includes a persisted Fashion Product Operating System at `/api/workspace-suite`.
It sits above the existing garment worker and Design Lab. WorkspaceProject is the central product record; collections group products; WorkspaceTeam stores members and brand settings. Existing worker jobs remain responsible for computational garment/pattern/image operations.
