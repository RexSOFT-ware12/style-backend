const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "fabricnow-dev-secret-change-me";

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * Protects write routes (create/update/delete product, etc).
 * Sends 401 if there's no valid "Authorization: Bearer <token>" header.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { signToken, requireAuth, JWT_SECRET };
