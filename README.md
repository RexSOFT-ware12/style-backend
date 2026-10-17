# FabricNow Style Backend

Main Node.js/Express API for the FabricNow company platform.

## Responsibilities
- Authentication and Google Sign-In
- Company/workspace accounts
- Stripe consumer and API subscriptions
- Stripe Billing Portal
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


## FabricNow Workspace AI update
The workspace pattern worker now supports OpenAI/Claude vision selection, Claude QA, Basic-plan-compatible exports with manifest metadata, African garment generation, fabric/print generation, mockups, technical flats, lookbooks, Aso-Ebi concepts, cutting-layout concepts, and AI product listing generation. Configure secrets only through environment variables.
