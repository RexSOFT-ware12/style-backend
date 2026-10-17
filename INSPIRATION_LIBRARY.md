# Shared Pinterest Inspiration Library

Platform-wide (all companies see the same data).

## Run
1. `npm install`
2. Make sure `.env` has `MONGODB_URI` (and optionally `MONGODB_DB`).
3. `npm run seed-inspirations`   (add `-- --dry` to preview)
4. `npm start`
5. Call `GET /api/inspiration-library` with `Authorization: Bearer <token>`.

## Endpoints
- `GET /api/inspiration-library?gender=&category=&region=&type=&q=&page=&limit=`
- `GET /api/inspiration-library/facets`

Data file: `src/data/african-fashion-inspiration.json` (edit, then re-run the seed).

## Free photos (Unsplash, or Pexels if you already have a key)
1. https://unsplash.com/developers -> Your apps -> New Application -> copy the Access Key
2. Add `UNSPLASH_ACCESS_KEY=...` (and `UNSPLASH_APP_NAME=fabricnow`) to `.env` and your production env
3. Restart. `GET /api/inspiration-library/photos?q=ankara+dress&page=1&limit=24`
Without a key the route returns `{configured:false}` and the UI shows setup instructions.
Unsplash: 50 req/hour in demo mode (responses cached 10 min); apply for production to get 5,000/hour.
Credit + hotlinking + download ping are handled for you.
