const express = require("express");
const bcrypt = require("bcrypt");
const WatchtowerUser = require("../models/WatchtowerUser");
const { sessions } = require("../helpers/sessionStore");

const router = express.Router();

function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Create a new Watchtower user (admin-only route)
router.post("/create", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  try {
    const uname = String(username).toLowerCase().trim();

    const existing = await WatchtowerUser.findOne({ username: uname });
    if (existing) return res.status(409).json({ error: "Username already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = new WatchtowerUser({ username: uname, passwordHash });
    await newUser.save();

    res.status(201).json({ message: "Watchtower user created successfully" });
  } catch (err) {
    console.error("Error creating Watchtower user:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const uname = String(username).toLowerCase().trim();
    const user = await WatchtowerUser.findOne({ username: uname });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = (typeof user.verifyPassword === "function")
      ? await user.verifyPassword(password)
      : await bcrypt.compare(password, user.passwordHash || "");

    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const sid = generateSessionId();
    sessions.set(sid, { username: user.username, userId: user._id, createdAt: Date.now() });

    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("wt_sid", sid, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "None" : "Lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({ message: "Login successful", username: user.username, sid });
  } catch (err) {
    console.error("[/api/watchtower-users/login] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", (req, res) => {
  const sid = req.cookies?.wt_sid || req.get("x-watchtower-session-id") || null;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ error: "Not authenticated" });
  const s = sessions.get(sid);
  res.json({ ok: true, username: s.username, userId: s.userId });
});

router.post("/logout", (req, res) => {
  const sid = req.cookies?.wt_sid || req.get("x-watchtower-session-id");
  if (sid) sessions.delete(sid);
  res.clearCookie("wt_sid", { path: "/" });
  res.json({ ok: true, message: "Logged out" });
});

module.exports = router;