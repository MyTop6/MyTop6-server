const express = require("express");
const bcrypt = require("bcrypt");
const MainframeUser = require("../models/MainframeUser");
const { sessions } = require("../helpers/sessionStore"); // shared memory store

const router = express.Router();

function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Create a new Mainframe user (admin-only in production)
router.post("/create", async (req, res) => {
  const { name, username, password, role } = req.body;

  if (!name || !username || !password) {
    return res.status(400).json({ error: "Missing required fields: name, username, password" });
  }

  try {
    const uname = String(username).toLowerCase().trim();
    const existing = await MainframeUser.findOne({ username: uname });
    if (existing) return res.status(409).json({ error: "Username already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new MainframeUser({
      name: String(name).trim(),
      username: uname,
      passwordHash,
      role, // optional
    });
    await user.save();

    res.status(201).json({
      message: "Mainframe user created successfully",
      user: { _id: user._id, name: user.name, username: user.username, role: user.role }
    });
  } catch (err) {
    console.error("Error creating Mainframe user:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Login route
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    if (!username || !password) return res.status(400).json({ error: "Missing username or password" });

    const uname = String(username).toLowerCase().trim();
    const user = await MainframeUser.findOne({ username: uname });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = (typeof user.verifyPassword === "function")
      ? await user.verifyPassword(password)
      : await bcrypt.compare(password, user.passwordHash || "");
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const sid = generateSessionId();
    sessions.set(sid, { app: "mainframe", username: user.username, userId: user._id, createdAt: Date.now() });

    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("mf_sid", sid, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "None" : "Lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: "Login successful",
      sid,
      user: { _id: user._id, name: user.name, username: user.username, role: user.role }
    });
  } catch (err) {
    console.error("[/api/mainframe-users/login] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Session validation
router.get("/me", async (req, res) => {
  const sid = req.cookies?.mf_sid || req.get("x-mainframe-session-id") || null;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ error: "Not authenticated" });

  const { userId } = sessions.get(sid);
  const user = await MainframeUser.findById(userId, { name: 1, username: 1, role: 1 }).lean();
  if (!user) return res.status(401).json({ error: "Session invalid" });

  res.json({ ok: true, user });
});

// Logout
router.post("/logout", (req, res) => {
  const sid = req.cookies?.mf_sid || req.get("x-mainframe-session-id");
  if (sid) sessions.delete(sid);
  res.clearCookie("mf_sid", { path: "/" });
  res.json({ ok: true, message: "Logged out" });
});

module.exports = router;