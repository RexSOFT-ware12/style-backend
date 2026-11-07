# style-backend: desktop API-key access (/api/desktop)

Copy into style-backend/ (paths match):
- src/middleware/requireApiKey.js  (new)  API-key auth for non-browser clients
- src/routes/desktop.js            (new)  GET /api/desktop/whoami, POST /api/desktop/assistant, GET /api/desktop/clo-policy
- test/desktop.test.js             (new)  node --test test/desktop.test.js   (13 tests, no DB/network)
- server.js.patch                  (3 lines: require + app.use + endpoint list)  ->  patch -p1 < server.js.patch  (from inside style-backend/)

Needs ANTHROPIC_API_KEY on the server (already in your .env.example). Optional: DESKTOP_ASSISTANT_MODEL, DESKTOP_ASSISTANT_PER_MIN.
The assistant only returns text; the desktop app shows every proposed action/script for approval.
