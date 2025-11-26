// middleware/auth.js
const { sessions } = require("../helpers/sessionStore");

// Extract sid from cookie, x-session-id header, or Authorization: Bearer <sid>
function extractSid(req) {
  const fromCookie = req.cookies?.sid || null;

  const fromHeader =
    req.get("x-session-id") ||
    req.get("X-Session-Id") || // case-insensitive safeguard
    null;

  const auth = req.get("authorization") || req.get("Authorization") || "";
  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  const fromBearer = bearerMatch ? bearerMatch[1] : null;

  return fromCookie || fromHeader || fromBearer || null;
}

function requireAuth(req, res, next) {
  const sid = extractSid(req);

  if (!sid || !sessions.has(sid)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // attach user/session for downstream handlers
  req.user = sessions.get(sid);
  req.sid = sid;
  next();
}

module.exports = requireAuth;