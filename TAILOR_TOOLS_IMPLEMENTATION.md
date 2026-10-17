# Tailor Tools backend

Added `src/models/TailorToolBoard.js`, `src/routes/tailorTools.js`, and `askTailorTools()` in `src/lib/gemini.js`.

Endpoints:
- GET/POST `/api/tailor-tools/boards`
- GET/PUT/DELETE `/api/tailor-tools/boards/:id`
- POST `/api/tailor-tools/boards/:id/validate`
- GET `/api/tailor-tools/boards/:id/export.svg`
- POST `/api/tailor-tools/ai`
- POST `/api/tailor-tools/stitch-plan`
- POST `/api/tailor-tools/cutting-layout`

The AI is grounded in structured project/measurement/fabric/board context and returns JSON. It is advisory; the frontend requires an explicit Apply action before suggestions alter the board.
