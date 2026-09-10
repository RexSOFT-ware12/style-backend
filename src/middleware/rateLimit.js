/**
 * Minimal in-memory sliding-window rate limiter, keyed by client IP.
 *
 * Good enough for a single-instance deployment (which is all this app runs
 * today) — swap for a shared store (e.g. Redis) if this ever runs behind
 * multiple instances, since counts here are per-process.
 *
 * Used to keep Fibo's /api/assistant/ask endpoint (a paid Gemini call, and
 * currently unauthenticated) from being hammered by a single client/script.
 */
function createRateLimiter({
  windowMs = 60_000,
  max = 20,
  message = "Too many requests — please slow down and try again shortly.",
} = {}) {
  const hits = new Map(); // ip -> timestamps[]

  // Periodically drop IPs with no recent activity so this map doesn't grow
  // unbounded on a long-running process.
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits.entries()) {
      const fresh = timestamps.filter((t) => t > cutoff);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs).unref?.();
  void cleanupInterval;

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (hits.get(key) || []).filter((t) => t > windowStart);
    timestamps.push(now);
    hits.set(key, timestamps);

    if (timestamps.length > max) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

module.exports = { createRateLimiter };
